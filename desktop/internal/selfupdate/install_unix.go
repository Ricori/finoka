//go:build !windows

package selfupdate

import (
	"os"
	"os/exec"
	"syscall"
)

// processAlive reports whether pid names a running process. Signal 0 performs
// no delivery but still runs the permission and existence checks.
func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

// detachCommand puts the helper in its own session so it is neither reaped
// nor signalled along with the process it is waiting for.
func detachCommand(command *exec.Cmd) {
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.Setsid = true
}
