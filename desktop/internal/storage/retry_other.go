//go:build !windows

package storage

import (
	"errors"
	"io/fs"
	"syscall"
)

// RetryableFileError reports whether a rename or delete failed for a reason
// that clears on its own. A cross-volume rename fails with EXDEV, which is not
// retryable and is what sends Move down its copy path.
func RetryableFileError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, fs.ErrPermission) || errors.Is(err, syscall.EBUSY)
}

func retryableFileError(err error) bool {
	return RetryableFileError(err)
}
