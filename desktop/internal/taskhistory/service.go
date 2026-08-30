// Package taskhistory owns the processing history shown on the tasks page.
// It lives outside preferences.json because the history is append-heavy
// machine state, not user settings: keeping it separate stops a 50-entry
// rewrite from touching the file that holds themes and window bounds.
package taskhistory

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Limit and maxEncodedSize bound what a renderer can persist; both mirror the
// caps the history carried while it lived in preferences.json.
const (
	Limit          = 50
	maxEncodedSize = 512 << 10
	fileName       = "task-history.json"
	legacyFileName = "preferences.json"
	currentSchema  = 1
)

type State struct {
	Schema  int              `json:"schema"`
	Entries []map[string]any `json:"entries"`
}

type Service struct {
	mu   sync.RWMutex
	path string
	data State
}

func New(dataDirectory string) (*Service, error) {
	root, err := filepath.Abs(dataDirectory)
	if err != nil {
		return nil, err
	}
	service := &Service{
		path: filepath.Join(root, fileName),
		data: State{Schema: currentSchema, Entries: []map[string]any{}},
	}
	loaded, err := service.load()
	if err != nil {
		return nil, err
	}
	if !loaded {
		// First run after the split: adopt whatever preferences.json still
		// carries so the user does not watch their history disappear.
		if entries := readLegacyHistory(filepath.Join(root, legacyFileName)); len(entries) > 0 {
			service.data.Entries = entries
			if err := writeAtomic(service.path, service.data); err != nil {
				return nil, err
			}
		}
	}
	return service, nil
}

func (s *Service) Get() []map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneEntries(s.data.Entries)
}

// Save replaces the whole history. The renderer owns ordering and dedup, so a
// partial merge here would only fight it.
func (s *Service) Save(entries []any) ([]map[string]any, error) {
	if entries == nil {
		entries = []any{}
	}
	if len(entries) > Limit {
		entries = entries[:Limit]
	}
	encoded, err := json.Marshal(entries)
	if err != nil || len(encoded) > maxEncodedSize {
		return s.Get(), errors.New("taskHistory exceeds the storage limit")
	}
	next := make([]map[string]any, 0, len(entries))
	for _, item := range entries {
		record, ok := item.(map[string]any)
		if !ok {
			return s.Get(), errors.New("taskHistory contains an invalid item")
		}
		next = append(next, cloneRecord(record))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state := State{Schema: currentSchema, Entries: next}
	if err := writeAtomic(s.path, state); err != nil {
		return cloneEntries(s.data.Entries), err
	}
	s.data = state
	return cloneEntries(s.data.Entries), nil
}

// load reports whether an existing history file was read.
func (s *Service) load() (bool, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		// A corrupt history is not worth blocking startup for; the tasks page
		// simply starts empty and the next save rewrites the file.
		return true, nil
	}
	s.data = State{Schema: currentSchema, Entries: trim(state.Entries)}
	return true, nil
}

func readLegacyHistory(path string) []map[string]any {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var legacy struct {
		TaskHistory []map[string]any `json:"taskHistory"`
	}
	if json.Unmarshal(data, &legacy) != nil {
		return nil
	}
	return trim(legacy.TaskHistory)
}

func trim(entries []map[string]any) []map[string]any {
	if entries == nil {
		return []map[string]any{}
	}
	if len(entries) > Limit {
		entries = entries[:Limit]
	}
	return cloneEntries(entries)
}

func cloneEntries(entries []map[string]any) []map[string]any {
	result := make([]map[string]any, len(entries))
	for index, record := range entries {
		result[index] = cloneRecord(record)
	}
	return result
}

func cloneRecord(record map[string]any) map[string]any {
	data, err := json.Marshal(record)
	if err != nil {
		return map[string]any{}
	}
	var result map[string]any
	if json.Unmarshal(data, &result) != nil {
		return map[string]any{}
	}
	return result
}

func writeAtomic(path string, value State) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".task-history-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err == nil {
		_, err = temporary.Write(append(data, '\n'))
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, path)
	}
	return err
}
