//go:build !production

package selfupdate

// Development builds never self-update on their own; set NONOKA_UPDATE_MANIFEST
// to exercise the flow against a test manifest.
const productionBuild = false
