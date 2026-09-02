package storage

import (
	"errors"
	"io/fs"

	"golang.org/x/sys/windows"
)

// RetryableFileError reports whether a rename or delete failed for a reason
// that clears on its own.
//
// Windows refuses to rename or remove a directory while anything inside it has
// an open handle, and Defender keeps handles on freshly written executables for
// several seconds — exactly the state a just-copied Python runtime is in. It
// surfaces as ERROR_ACCESS_DENIED or ERROR_SHARING_VIOLATION. A cross-volume
// rename fails with ERROR_NOT_SAME_DEVICE instead, which is not retryable and
// is what sends Move down its copy path.
func RetryableFileError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, fs.ErrPermission) {
		return true
	}
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) || errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}

func retryableFileError(err error) bool {
	return RetryableFileError(err)
}
