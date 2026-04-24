#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        echo "windows"
    else
        echo "unknown"
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Install ffmpeg based on OS
install_ffmpeg() {
    local os=$1
    log_info "Instalando ffmpeg..."

    case $os in
        linux)
            if command_exists apt; then
                sudo apt update && sudo apt install -y ffmpeg
            elif command_exists dnf; then
                sudo dnf install -y ffmpeg
            elif command_exists pacman; then
                sudo pacman -S --noconfirm ffmpeg
            else
                log_error "Gerenciador de pacotes não suportado. Instale o ffmpeg manualmente."
                exit 1
            fi
            ;;
        macos)
            if command_exists brew; then
                brew install ffmpeg
            else
                log_error "Homebrew não encontrado. Instale o Homebrew primeiro: https://brew.sh"
                exit 1
            fi
            ;;
        windows)
            log_warn "No Windows, instale o ffmpeg manualmente: https://ffmpeg.org/download.html"
            exit 1
            ;;
    esac
}

# Install uv
install_uv() {
    log_info "Instalando uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
}

# Setup Python environment
setup_python() {
    log_info "Configurando ambiente Python com uv..."

    if ! command_exists uv; then
        install_uv
    fi

    uv venv
    uv sync
    log_success "Ambiente Python configurado com sucesso!"
}

# Setup Node.js/bun dependencies
setup_frontend() {
    log_info "Instalando dependências do frontend..."

    if ! command_exists bun; then
        log_info "Instalando bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi

    bun install
    log_success "Dependências do frontend instaladas com sucesso!"
}

# Main setup function
main() {
    echo ""
    echo "========================================"
    echo "  Remove Silence - Setup Script"
    echo "========================================"
    echo ""

    local os
    os=$(detect_os)

    if [[ "$os" == "unknown" ]]; then
        log_error "Sistema operacional não suportado."
        exit 1
    fi

    log_info "Sistema detectado: $os"
    echo ""

    # Check and install ffmpeg
    if ! command_exists ffmpeg || ! command_exists ffprobe; then
        log_warn "ffmpeg e/ou ffprobe não encontrados."
        install_ffmpeg "$os"
    else
        log_success "ffmpeg já está instalado."
    fi
    echo ""

    # Setup Python environment
    setup_python
    echo ""

    # Setup frontend dependencies
    setup_frontend
    echo ""

    echo "========================================"
    log_success "Setup concluído com sucesso!"
    echo "========================================"
    echo ""
    log_info "Para iniciar o projeto em modo desenvolvimento:"
    log_info "  bun run dev"
    echo ""
}

main "$@"
