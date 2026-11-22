package odyle

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"testing"
)

// The push encryption uses the standard library's HKDF (crypto/hkdf). Its bytes are the hand-rolled
// extract and one-block expand it replaced, kept here as they were, for many random keys, secrets
// and salts, an empty salt included.
func TestPushEncryptionIsTheSameWithTheStandardHKDF(t *testing.T) {
	for i := range 200 {
		client, err := ecdh.P256().GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		sender, err := ecdh.P256().GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		auth, salt, message := make([]byte, 16), make([]byte, 16), make([]byte, i*7)
		rand.Read(auth)
		rand.Read(salt)
		rand.Read(message)
		if i == 0 {
			salt = nil
		}
		got, err := encryptPush(message, client.PublicKey().Bytes(), auth, sender, salt)
		if err != nil {
			t.Fatal(err)
		}
		want, err := oldEncryptPush(message, client.PublicKey().Bytes(), auth, sender, salt)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("message %d: the encryption differs", i)
		}
	}
}

func oldHkdfExtract(salt, secret []byte) []byte {
	mac := hmac.New(sha256.New, salt)
	mac.Write(secret)
	return mac.Sum(nil)
}

// hkdfExpand for up to 32 bytes: one block.
func oldHkdfExpand(prk, info []byte, size int) []byte {
	mac := hmac.New(sha256.New, prk)
	mac.Write(info)
	mac.Write([]byte{1})
	return mac.Sum(nil)[:size]
}

// encryptPush encrypts a message for one subscription (RFC 8291) with a new key and salt:
// the body is the aes128gcm header (salt, record size, the sender's public key) and one record.
func oldEncryptPush(message, clientPublic, authSecret []byte, sender *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	client, err := ecdh.P256().NewPublicKey(clientPublic)
	if err != nil {
		return nil, errors.New("the subscription's key is not a P-256 public key")
	}
	shared, err := sender.ECDH(client)
	if err != nil {
		return nil, err
	}
	senderPublic := sender.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), clientPublic...), senderPublic...)
	ikm := oldHkdfExpand(oldHkdfExtract(authSecret, shared), info, 32)
	prk := oldHkdfExtract(salt, ikm)
	block, err := aes.NewCipher(oldHkdfExpand(prk, []byte("Content-Encoding: aes128gcm\x00"), 16))
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	header := make([]byte, 0, 21+len(senderPublic))
	header = append(header, salt...)
	header = binary.BigEndian.AppendUint32(header, 4096)
	header = append(header, byte(len(senderPublic)))
	header = append(header, senderPublic...)
	return gcm.Seal(header, oldHkdfExpand(prk, []byte("Content-Encoding: nonce\x00"), 12), append(bytes.Clone(message), 2), nil), nil
}
