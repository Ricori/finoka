package library

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

type LegacyMigrationStatus struct {
	Available  bool   `json:"available"`
	Root       string `json:"root"`
	Entries    int    `json:"entries"`
	LocalMedia int    `json:"localMedia"`
}

type LegacyMigrationResult struct {
	Imported int             `json:"imported"`
	Skipped  int             `json:"skipped"`
	Failed   []ImportFailure `json:"failed"`
}

type legacyEntry struct {
	ID        string `json:"id"`
	Source    string `json:"srcPath"`
	Title     string `json:"title"`
	CloudOnly bool   `json:"cloudOnly"`
}

type legacyConfig struct {
	CacheDir string `json:"cacheDir"`
}

func defaultLegacyRoot() string {
	if configured := strings.TrimSpace(os.Getenv("NONOKA_DATA_DIR")); configured != "" {
		absolute, _ := filepath.Abs(configured)
		return absolute
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "Nonoka")
}

func (s *Service) LegacyMigrationStatus() LegacyMigrationStatus {
	entries, config, err := readLegacyLibrary(s.legacyRoot)
	status := LegacyMigrationStatus{Root: s.legacyRoot, Entries: len(entries)}
	if err != nil {
		return status
	}
	for _, entry := range entries {
		if legacySource(s.legacyRoot, config.CacheDir, entry) != "" {
			status.LocalMedia++
		}
	}
	status.Available = status.LocalMedia > 0
	return status
}

func (s *Service) MigrateLegacyLibrary() LegacyMigrationResult {
	result := LegacyMigrationResult{Failed: []ImportFailure{}}
	entries, config, err := readLegacyLibrary(s.legacyRoot)
	if err != nil {
		result.Failed = append(result.Failed, ImportFailure{Path: s.legacyRoot, Name: "Nonoka", Message: err.Error()})
		return result
	}
	for _, legacy := range entries {
		source := legacySource(s.legacyRoot, config.CacheDir, legacy)
		if source == "" {
			result.Skipped++
			continue
		}
		entry, added, importErr := s.importOne(source)
		if importErr != nil {
			result.Failed = append(result.Failed, ImportFailure{Path: source, Name: filepath.Base(source), Message: importErr.Error()})
			continue
		}
		if !added {
			result.Skipped++
			continue
		}
		if title := strings.TrimSpace(legacy.Title); title != "" && title != entry.Title {
			_, _ = s.Rename(entry.ID, title)
		}
		result.Imported++
	}
	if result.Imported > 0 {
		s.emitChanged()
	}
	return result
}

func readLegacyLibrary(root string) ([]legacyEntry, legacyConfig, error) {
	if strings.TrimSpace(root) == "" {
		return nil, legacyConfig{}, errors.New("Nonoka data directory is unavailable")
	}
	data, err := os.ReadFile(filepath.Join(root, "library.json"))
	if err != nil {
		return nil, legacyConfig{}, err
	}
	var entries []legacyEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, legacyConfig{}, err
	}
	config := legacyConfig{CacheDir: filepath.Join(root, "videos")}
	if configData, readErr := os.ReadFile(filepath.Join(root, "config.json")); readErr == nil {
		_ = json.Unmarshal(configData, &config)
	}
	return entries, config, nil
}

func legacySource(root, cacheDir string, entry legacyEntry) string {
	candidates := []string{strings.TrimSpace(entry.Source)}
	if strings.TrimSpace(cacheDir) != "" && strings.TrimSpace(entry.ID) != "" {
		candidates = append(candidates, filepath.Join(cacheDir, entry.ID+".mp4"))
	}
	if strings.TrimSpace(entry.ID) != "" {
		candidates = append(candidates, filepath.Join(root, "videos", entry.ID+".mp4"))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if stat, err := os.Stat(absolute); err == nil && stat.Mode().IsRegular() {
			return absolute
		}
	}
	return ""
}
