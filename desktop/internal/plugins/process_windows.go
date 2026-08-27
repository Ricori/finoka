//go:build windows

package plugins

import (
	"os/exec"
	"syscall"
)

func configurePluginCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
