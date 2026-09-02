// Command configure reapplies Nonoka X-specific changes after Wails regenerates
// its platform metadata.
package main

import (
	"bytes"
	"os"
)

var localNetworking = []byte(`        <key>NSAppTransportSecurity</key>
        <dict>
            <key>NSAllowsLocalNetworking</key>
            <true/>
        </dict>
`)

func main() {
	for _, unsupported := range []string{"build/ios", "build/linux", "build/windows/nsis"} {
		must(os.RemoveAll(unsupported))
	}
	for _, path := range []string{"build/darwin/Info.plist", "build/darwin/Info.dev.plist"} {
		contents, err := os.ReadFile(path)
		must(err)
		if bytes.Contains(contents, []byte("NSAllowsLocalNetworking")) {
			continue
		}
		marker := []byte("    </dict>\n</plist>")
		index := bytes.LastIndex(contents, marker)
		if index < 0 {
			panic("unexpected plist layout: " + path)
		}
		updated := make([]byte, 0, len(contents)+len(localNetworking))
		updated = append(updated, contents[:index]...)
		updated = append(updated, localNetworking...)
		updated = append(updated, contents[index:]...)
		must(os.WriteFile(path, updated, 0o644))
	}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
