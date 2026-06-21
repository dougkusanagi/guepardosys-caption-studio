# Diretrizes para Agentes de IA — Guepardosys Caption Studio

## Otimização de Compilação
- **Build rápido de teste:** Quando precisar compilar e empacotar a aplicação para testes rápidos, builde **apenas a versão msi** para poupar tempo (evita a compilação do instalador NSIS).
- Para fazer isso, execute a ferramenta de build especificando o formato `msi` como argumento:
  ```bash
  bun run tauri build -- --bundles msi
  ```
