package app

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const bundledResourcePrefix = "bundled/finoka"

// The build task stages the sidecar and pinned FineSub snapshot here before
// compiling. The tracked placeholder also keeps source-only Go tests valid.
//
//go:embed all:bundled/finoka
var bundledResources embed.FS

func ensureBundledResources(dataDirectory string) (string, error) {
	return extractBundledResources(bundledResources, bundledResourcePrefix, dataDirectory)
}

func extractBundledResources(source fs.FS, prefix, dataDirectory string) (string, error) {
	manifestPath := prefix + "/STAGED.json"
	manifest, err := fs.ReadFile(source, manifestPath)
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read embedded resource manifest: %w", err)
	}
	digest := sha256.Sum256(manifest)
	version := hex.EncodeToString(digest[:8])
	root := filepath.Join(dataDirectory, "app-resources", version, "finoka")
	installedManifest := filepath.Join(root, "STAGED.json")
	if existing, readErr := os.ReadFile(installedManifest); readErr == nil && bytes.Equal(existing, manifest) {
		return root, nil
	}
	if err := os.RemoveAll(root); err != nil {
		return "", fmt.Errorf("replace embedded resources: %w", err)
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create embedded resource directory: %w", err)
	}
	err = fs.WalkDir(source, prefix, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || path == manifestPath || entry.Name() == ".gitkeep" {
			return nil
		}
		relative := strings.TrimPrefix(path, prefix+"/")
		if relative == path || relative == "" || strings.Contains(relative, "..") {
			return fmt.Errorf("invalid embedded resource path %q", path)
		}
		contents, err := fs.ReadFile(source, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return err
		}
		return os.WriteFile(destination, contents, 0o600)
	})
	if err != nil {
		return "", fmt.Errorf("extract embedded resources: %w", err)
	}
	if err := os.WriteFile(installedManifest, manifest, 0o600); err != nil {
		return "", fmt.Errorf("commit embedded resources: %w", err)
	}
	return root, nil
}
