//go:build !odyletest

package migrations

func skipped(string) bool { return false }
