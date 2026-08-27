package selfupdate

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// CleanupReplacedExecutables removes the "<name>.exe.old.<timestamp>" copies the
// Windows update helper leaves behind. The old image is still mapped while the
// helper exits, so the new build retries for a short window after launch.
func CleanupReplacedExecutables() {
	if runtime.GOOS != "windows" {
		return
	}
	executable, err := os.Executable()
	if err != nil {
		return
	}
	go func() {
		for attempt := 0; attempt < 60; attempt++ {
			if removeReplacedExecutables(executable) == 0 {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()
}

func removeReplacedExecutables(executable string) int {
	directory, name := filepath.Dir(executable), filepath.Base(executable)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return 0
	}
	prefix := name + ".old."
	remaining := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		if _, err := strconv.ParseInt(strings.TrimPrefix(entry.Name(), prefix), 10, 64); err != nil {
			continue
		}
		if err := os.Remove(filepath.Join(directory, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			remaining++
		}
	}
	return remaining
}
