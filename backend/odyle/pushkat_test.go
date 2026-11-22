package odyle

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/binary"
	"testing"
)

// RFC 8291 Appendix A: the known answer of Web Push message encryption. encryptPush takes the
// sender's key and the salt as parameters, so the example's own can be used and the body
// compared byte for byte with the RFC's.
func TestEncryptPushMatchesRFC8291AppendixA(t *testing.T) {
	decode := func(s string) []byte {
		t.Helper()
		raw, err := b64.DecodeString(s)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	plaintext := []byte("When I grow up, I want to be a watermelon")
	asPrivate := decode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")
	asPublic := decode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
	uaPublic := decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	authSecret := decode("BTBZMqHH6r4Tts7J_aSIgg")
	salt := decode("DGv6ra1nlYgDCS1FRnbzlw")
	want := decode("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")

	sender, err := ecdh.P256().NewPrivateKey(asPrivate)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(sender.PublicKey().Bytes(), asPublic) {
		t.Fatal("the example's private key does not give its public key")
	}
	got, err := encryptPush(plaintext, uaPublic, authSecret, sender, salt)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("body\n%x\nwant\n%x", got, want)
	}
	// The header is the salt, the record size 4096 and the sender's public key (RFC 8188).
	if !bytes.Equal(got[:16], salt) || binary.BigEndian.Uint32(got[16:20]) != 4096 || got[20] != 65 || !bytes.Equal(got[21:86], asPublic) {
		t.Fatalf("header %x", got[:86])
	}
}

// A subscription's key that is not a P-256 point, and one that is not a key, are refused.
func TestEncryptPushRefusesBadKeys(t *testing.T) {
	sender, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	salt, auth := make([]byte, 16), make([]byte, 16)
	for name, key := range map[string][]byte{"empty": nil, "short": make([]byte, 64), "off the curve": append([]byte{4}, make([]byte, 64)...), "compressed": append([]byte{2}, make([]byte, 32)...)} {
		if _, err := encryptPush([]byte("x"), key, auth, sender, salt); err == nil {
			t.Errorf("%s: a bad key was accepted", name)
		}
	}
}
