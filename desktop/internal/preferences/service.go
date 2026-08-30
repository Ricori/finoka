package preferences

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

type State struct {
	Schema           int                     `json:"schema"`
	HomeTheme        string                  `json:"homeTheme"`
	EditorTheme      string                  `json:"editorTheme"`
	SidebarCollapsed bool                    `json:"sidebarCollapsed"`
	LibraryView      string                  `json:"libraryView"`
	Bounds           map[string]WindowBounds `json:"bounds"`
}

type WindowBounds struct {
	X          int  `json:"x"`
	Y          int  `json:"y"`
	Width      int  `json:"width"`
	Height     int  `json:"height"`
	Maximized  bool `json:"maximized"`
	FullScreen bool `json:"fullScreen"`
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
		path: filepath.Join(root, "preferences.json"),
		data: State{Schema: 2, HomeTheme: "light", EditorTheme: "dark", LibraryView: "grid", Bounds: map[string]WindowBounds{}},
	}
	if err := service.load(); err != nil {
		return nil, err
	}
	return service, nil
}

func (s *Service) Get() State {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneState(s.data)
}

func (s *Service) Save(patch map[string]any) (State, error) {
	if patch == nil {
		return s.Get(), errors.New("preferences patch is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.data
	if value, exists := patch["homeTheme"]; exists {
		theme, ok := value.(string)
		if !ok || (theme != "dark" && theme != "light") {
			return s.data, errors.New("homeTheme must be dark or light")
		}
		next.HomeTheme = theme
	}
	if value, exists := patch["editorTheme"]; exists {
		theme, ok := value.(string)
		if !ok || (theme != "dark" && theme != "light") {
			return s.data, errors.New("editorTheme must be dark or light")
		}
		next.EditorTheme = theme
	}
	if value, exists := patch["sidebarCollapsed"]; exists {
		collapsed, ok := value.(bool)
		if !ok {
			return s.data, errors.New("sidebarCollapsed must be a boolean")
		}
		next.SidebarCollapsed = collapsed
	}
	if value, exists := patch["libraryView"]; exists {
		view, ok := value.(string)
		if !ok || (view != "grid" && view != "list") {
			return s.data, errors.New("libraryView must be grid or list")
		}
		next.LibraryView = view
	}
	if err := writeAtomic(s.path, next); err != nil {
		return s.data, err
	}
	s.data = next
	return cloneState(s.data), nil
}

func (s *Service) GetWindowBounds(kind string) (WindowBounds, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	bounds, ok := s.data.Bounds[kind]
	return bounds, ok
}

func (s *Service) SetWindowBounds(kind string, bounds WindowBounds) error {
	if kind != "home" && kind != "editor" {
		return errors.New("unknown window kind")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.data)
	next.Bounds[kind] = bounds
	if err := writeAtomic(s.path, next); err != nil {
		return err
	}
	s.data = next
	return nil
}

func (s *Service) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	if state.HomeTheme != "dark" && state.HomeTheme != "light" {
		state.HomeTheme = "light"
	}
	if state.EditorTheme != "dark" && state.EditorTheme != "light" {
		state.EditorTheme = "dark"
	}
	if state.LibraryView != "grid" && state.LibraryView != "list" {
		state.LibraryView = "grid"
	}
	state.Schema = 2
	if state.Bounds == nil {
		state.Bounds = map[string]WindowBounds{}
	}
	s.data = state
	return nil
}

func cloneState(state State) State {
	result := state
	result.Bounds = make(map[string]WindowBounds, len(state.Bounds))
	for kind, bounds := range state.Bounds {
		result.Bounds[kind] = bounds
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
	temporary, err := os.CreateTemp(filepath.Dir(path), ".preferences-*.tmp")
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
