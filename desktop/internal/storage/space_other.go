//go:build !windows

package storage

import (
	"path/filepath"

	"golang.org/x/sys/unix"
)

// FreeSpace reports the bytes still available to this user on the filesystem
// that holds directory, walking up to the nearest existing ancestor so a
// destination that has not been created yet still reports its volume.
func FreeSpace(directory string) int64 {
	for current := filepath.Clean(directory); current != ""; {
		var stat unix.Statfs_t
		if unix.Statfs(current, &stat) == nil {
			return int64(stat.Bavail) * int64(stat.Bsize)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return 0
		}
		current = parent
	}
	return 0
}
