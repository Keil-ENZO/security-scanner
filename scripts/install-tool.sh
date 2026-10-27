#!/bin/sh
# Usage: scripts/install-tool.sh <dest-dir> <tool>...
# Tools: nuclei trivy syft grype cosign. Official release binaries, linux amd64.
# Every archive is checked against the release checksums. When the checksums file is signed,
# cosign verifies its signature first, so a tampered release fails even with matching sums
set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/tools.env"
dest=$1
shift
mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"

fetch() { curl -fsSLO --retry 3 "$1"; }

cosign=$tmp/bin/cosign
ensure_cosign() {
  [ -x "$cosign" ] && return
  fetch "https://github.com/sigstore/cosign/releases/download/v$COSIGN_VERSION/cosign-linux-amd64"
  echo "$COSIGN_SHA256  cosign-linux-amd64" | sha256sum -c -
  mkdir -p "$tmp/bin"
  install -m 0755 cosign-linux-amd64 "$cosign"
}

# $1 GitHub repository, $2 release base URL, $3 checksums file, $4 signed or not
checked() {
  fetch "$2/$3"
  if [ "$4" = signed ]; then
    fetch "$2/$3.sigstore.json"
    ensure_cosign
    "$cosign" verify-blob --bundle "$3.sigstore.json" \
      --certificate-identity-regexp "^https://github.com/$1/" \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com "$3"
  fi
  sha256sum --ignore-missing -c "$3"
}

for tool in "$@"; do
  case "$tool" in
    nuclei)
      # Nuclei does not sign its checksums yet
      base="https://github.com/projectdiscovery/nuclei/releases/download/v$NUCLEI_VERSION"
      fetch "$base/nuclei_${NUCLEI_VERSION}_linux_amd64.zip"
      checked projectdiscovery/nuclei "$base" "nuclei_${NUCLEI_VERSION}_checksums.txt" unsigned
      unzip -qo "nuclei_${NUCLEI_VERSION}_linux_amd64.zip" nuclei
      ;;
    trivy)
      base="https://github.com/aquasecurity/trivy/releases/download/v$TRIVY_VERSION"
      fetch "$base/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
      checked aquasecurity/trivy "$base" "trivy_${TRIVY_VERSION}_checksums.txt" signed
      tar xzf "trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" trivy
      ;;
    syft | grype)
      [ "$tool" = syft ] && version=$SYFT_VERSION || version=$GRYPE_VERSION
      base="https://github.com/anchore/$tool/releases/download/v$version"
      fetch "$base/${tool}_${version}_linux_amd64.tar.gz"
      checked "anchore/$tool" "$base" "${tool}_${version}_checksums.txt" signed
      tar xzf "${tool}_${version}_linux_amd64.tar.gz" "$tool"
      ;;
    cosign)
      ensure_cosign
      install -m 0755 "$cosign" "$dest/cosign"
      continue
      ;;
    *)
      echo "unknown tool: $tool" >&2
      exit 1
      ;;
  esac
  install -m 0755 "$tool" "$dest/$tool"
done
