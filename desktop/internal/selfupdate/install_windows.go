//go:build windows

package selfupdate

import (
	"os/exec"
	"syscall"
)

// processQueryLimitedInformation is the least access that still allows
// GetExitCodeProcess, and stillActive (STILL_ACTIVE) is what that call
// reports while the process is running. Declared here so the helper stays on
// the standard library.
const (
	processQueryLimitedInformation = 0x1000
	stillActive                    = 259
)

// processAlive reports whether pid names a running process. Signalling is not
// a usable probe on Windows, so ask the kernel for the exit code instead: a
// process that has not exited yet has none.
func processAlive(pid int) bool {
	handle, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)
	var code uint32
	if syscall.GetExitCodeProcess(handle, &code) != nil {
		return false
	}
	return code == stillActive
}

// detachCommand keeps the helper alive past our exit and off the desktop: it
// outlives the process it is waiting for, and it must not flash a console.
func detachCommand(command *exec.Cmd) {
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	const (
		detachedProcess     = 0x00000008
		createNoWindow      = 0x08000000
		createNewProcessGrp = 0x00000200
	)
	command.SysProcAttr.CreationFlags |= detachedProcess | createNoWindow | createNewProcessGrp
	command.SysProcAttr.HideWindow = true
}
