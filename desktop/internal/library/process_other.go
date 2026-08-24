//go:build !windows

package library

import "os/exec"

func configureMediaCommand(_ *exec.Cmd) {}
