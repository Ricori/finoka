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
