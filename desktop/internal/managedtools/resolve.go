// Package managedtools resolves project-managed command-line dependencies.
package managedtools

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// PythonEnvironment overrides the interpreter Finoka runs Python code with.
const PythonEnvironment = "FINOKA_PYTHON"

// Find prefers an existing system tool and falls back to the verified copy in
// Finoka's application-data runtime. The active version pointer is written
// atomically by the Python provisioner after download and checksum validation.
func Find(dataDirectory, name string) (string, error) {
	if executable, err := exec.LookPath(name); err == nil {
		return executable, nil
	}
	if executable := findManaged(dataDirectory, name); executable != "" {
		return executable, nil
	}
	return "", errors.New(name + " is not installed")
}

func findManaged(dataDirectory, name string) string {
	filename := name
	if runtime.GOOS == "windows" {
		filename += ".exe"
	}
	resourceIDs := []string{name}
	if name == "ffprobe" {
		// The Windows FFmpeg archive contains both tools in one resource.
		resourceIDs = append(resourceIDs, "ffmpeg")
	}
	for _, resourceID := range resourceIDs {
		root := filepath.Join(dataDirectory, "finesub", "runtime", resourceID)
		version := activeVersion(filepath.Join(root, "current.json"))
		if version == "" {
			continue
		}
		active := filepath.Join(root, version)
		var result string
		_ = filepath.WalkDir(active, func(path string, entry os.DirEntry, err error) error {
			if err != nil || result != "" {
				return filepath.SkipAll
			}
			if entry.IsDir() || !strings.EqualFold(entry.Name(), filename) {
				return nil
			}
			info, infoErr := entry.Info()
			if infoErr != nil || !info.Mode().IsRegular() {
				return nil
			}
			if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
				return nil
			}
			result = path
			return filepath.SkipAll
		})
		if result != "" {
			return result
		}
	}
	return ""
}

func activeVersion(pointer string) string {
	data, err := os.ReadFile(pointer)
	if err != nil {
		return ""
	}
	var value struct {
		Current string `json:"current"`
	}
	if json.Unmarshal(data, &value) != nil || value.Current == "" || filepath.Base(value.Current) != value.Current || strings.ContainsAny(value.Current, `/\\`) {
		return ""
	}
	return value.Current
}

// Everything below resolves yt-dlp, which ships as a Python wheel.

// BootstrapPython locates the interpreter Finoka installs for itself.
func BootstrapPython(dataDirectory string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(dataDirectory, "bootstrap", "launcher", "Scripts", "python.exe")
	}
	return filepath.Join(dataDirectory, "bootstrap", "launcher", "bin", "python3")
}

// FindYTDLP resolves how to run yt-dlp. Finoka installs it as a Python wheel
// rather than a standalone binary, so Find alone cannot see it: the wheel's
// __main__.py runs through the managed interpreter, which is how the FineSub
// pipeline already uses it. prefix must precede yt-dlp's own arguments.
func FindYTDLP(dataDirectory string) (executable string, prefix []string, err error) {
	if native, findErr := Find(dataDirectory, "yt-dlp"); findErr == nil {
		return native, nil, nil
	}
	notInstalled := errors.New("Finoka yt-dlp 未安装：请在「运行环境」中安装可选工具 yt-dlp")
	root := filepath.Join(dataDirectory, "finesub", "runtime", "yt-dlp")
	version := activeVersion(filepath.Join(root, "current.json"))
	if version == "" {
		return "", nil, notInstalled
	}
	entrypoint := filepath.Join(root, version, "yt_dlp", "__main__.py")
	if info, statErr := os.Stat(entrypoint); statErr != nil || !info.Mode().IsRegular() {
		return "", nil, notInstalled
	}
	python := findPython(dataDirectory)
	if python == "" {
		return "", nil, errors.New("找不到可运行 yt-dlp 的 Python：请在「运行环境」中完成 Python 运行时安装")
	}
	// -s keeps user site-packages out of the run.
	return python, []string{"-s", entrypoint}, nil
}

func findPython(dataDirectory string) string {
	for _, candidate := range []string{os.Getenv(PythonEnvironment), BootstrapPython(dataDirectory)} {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	for _, name := range []string{"python3.12", "python3", "python"} {
		if executable, err := exec.LookPath(name); err == nil {
			return executable
		}
	}
	return ""
}