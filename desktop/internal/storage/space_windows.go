package storage

import (
	"path/filepath"

	"golang.org/x/sys/windows"
)

// FreeSpace reports the bytes still available to this user on the volume that
// holds directory, walking up to the nearest existing ancestor so a destination
// that has not been created yet still reports its drive.
func FreeSpace(directory string) int64 {
	for current := filepath.Clean(directory); current != ""; {
		var free, total, totalFree uint64
		path, err := windows.UTF16PtrFromString(current)
		if err == nil && windows.GetDiskFreeSpaceEx(path, &free, &total, &totalFree) == nil {
			return int64(free)
		}
		parent := filepath.Dir(current)
		if parent == current {
			return 0
		}
		current = parent
	}
	return 0
}
