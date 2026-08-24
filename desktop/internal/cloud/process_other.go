//go:build !windows

package cloud

import "os/exec"

func configureCloudCommand(_ *exec.Cmd) {}
