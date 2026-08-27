//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

func configureBootstrapProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true}
}
