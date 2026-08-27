//go:build !windows

package plugins

import "os/exec"

func configurePluginCommand(_ *exec.Cmd) {}
