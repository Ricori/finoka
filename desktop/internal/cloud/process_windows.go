//go:build windows

package cloud

import (
	"os/exec"
	"syscall"
)

func configureCloudCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
