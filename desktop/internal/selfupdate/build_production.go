//go:build production

package selfupdate

// Release builds carry the production tag (see build/windows/Taskfile.yml), and
// only those check the update manifest on their own.
const productionBuild = true
