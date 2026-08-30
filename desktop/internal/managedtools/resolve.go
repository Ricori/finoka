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

// YTDLP describes how to invoke yt-dlp: the executable to run, arguments that
// must precede yt-dlp's own, and extra environment variables the command needs.
// A native binary needs neither of the latter two.
type YTDLP struct {
	Executable  string
	Prefix      []string
	Environment []string
}

// FindYTDLP resolves how to run yt-dlp. Finoka installs it as a Python wheel
// rather than a standalone binary, so Find alone cannot see it: the package is
// imported through the managed interpreter with PYTHONPATH pointing at the
// unpacked wheel, the same way finoka.provision runs it for the FineSub
// pipeline. A real binary still wins, so swapping the resource back to a
// standalone build needs no change here.
func FindYTDLP(dataDirectory string) (YTDLP, error) {
	if native, err := Find(dataDirectory, "yt-dlp"); err == nil {
		return YTDLP{Executable: native}, nil
	}
	notInstalled := errors.New("Finoka yt-dlp is not installed; install it from 运行环境 first")
	root := filepath.Join(dataDirectory, "finesub", "runtime", "yt-dlp")
	version := activeVersion(filepath.Join(root, "current.json"))
	if version == "" {
		return YTDLP{}, notInstalled
	}
	// The runtime manifest declares yt_dlp/__init__.py as the resource's
	// required file, so provisioner and host agree on what "installed" means.
	packageRoot := filepath.Join(root, version)
	if info, err := os.Stat(filepath.Join(packageRoot, "yt_dlp", "__init__.py")); err != nil || !info.Mode().IsRegular() {
		return YTDLP{}, notInstalled
	}
	python := findPython(dataDirectory)
	if python == "" {
		return YTDLP{}, errors.New("no Python interpreter is available to run yt-dlp; finish the Python runtime setup in 运行环境 first")
	}
	// -s keeps user site-packages out of the run; PYTHONPATH makes the unpacked
	// wheel importable without installing it into the interpreter.
	return YTDLP{
		Executable:  python,
		Prefix:      []string{"-s", "-m", "yt_dlp"},
		Environment: []string{pythonPath(packageRoot)},
	}, nil
}

// pythonPath prepends the unpacked wheel to any PYTHONPATH already inherited
// from the environment rather than replacing it.
func pythonPath(packageRoot string) string {
	if inherited := os.Getenv("PYTHONPATH"); inherited != "" {
		return "PYTHONPATH=" + packageRoot + string(os.PathListSeparator) + inherited
	}
	return "PYTHONPATH=" + packageRoot
}

func findPython(dataDirectory string) string {
	candidates := []string{os.Getenv(PythonEnvironment), BootstrapPython(dataDirectory), "python3.12", "python3", "python"}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
		// FINOKA_PYTHON may name an interpreter on PATH instead of giving a
		// path, which is how SidecarConfig already accepts it.
		if executable, err := exec.LookPath(candidate); err == nil {
			return executable
		}
	}
	return ""
}
