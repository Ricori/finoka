//go:build windows

package library

import (
	"os/exec"
	"syscall"
)

func configureMediaCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
