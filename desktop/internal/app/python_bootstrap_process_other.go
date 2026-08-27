//go:build !windows

package app

import "os/exec"

func configureBootstrapProcess(_ *exec.Cmd) {}
