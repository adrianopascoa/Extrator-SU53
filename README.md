# Extrator SU53

Consolidador de logs de autorização da transação **SAP SU53** em lote, projetado para analistas **SAP Basis & Segurança** unificarem objetos, campos, valores e usuários sem duplicidades — com processamento **100% local no navegador** e zero dependência de APIs externas.

---

## Principais Recursos

- **Importação em lote multi-formato**:
  - **HTML / HTM**: relatórios exportados diretamente do SAP GUI (`Lista → Gravar/Enviar → Arquivo local`).
  - **PDF**: leitura híbrida com extração exata da camada de texto e fallback automático para OCR local quando o PDF contém apenas prints colados (limite de segurança de 50 páginas / 25 MB por arquivo).
  - **Imagens (Print + `Ctrl+V`)**: suporte a `.PNG`, `.JPG`, `.WEBP`, `.BMP` e `.GIF`, além de colagem direta da área de transferência com `Ctrl+V` em qualquer ponto da janela.
- **Processamento 100% local e offline**:
  - Motor OCR (`Tesseract.js` + WebAssembly + dicionário `eng.traineddata.gz`) e leitor de PDF (`PDF.js`) servidos pela própria origem da aplicação, sem envio de dados corporativos a servidores externos nem consumo de cotas de IA.
- **Deduplicação e consolidação inteligente**:
  - Agrupa ocorrências repetidas por **Objeto** e **Campo**, preservando a rastreabilidade por **Usuário(s)** e **Sistema / Mandante**.
- **Separação e filtro por múltiplos usuários**:
  - Em lotes com prints ou HTMLs de vários usuários, permite filtrar a visualização por usuário específico e gera uma aba dedicada na planilha exportada.
- **Auditoria configurável de itens críticos**:
  - Destaca automaticamente transações e objetos sensíveis (ex.: `S_DEVELOP`, `S_DBG`, `M_EINK_FRG`, `SE16N`, `SE80`, `RZ11`, `SM01`, etc.) com lista personalizável salva no navegador.
- **Revisão e edição pós-OCR**:
  - **Modo Tabela**: clique em qualquer *Objeto*, *Campo*, *Valor* ou *Usuário* para corrigir caracteres confundidos pelo OCR antes de exportar.
  - **Modo Console**: edição livre do texto consolidado com atalhos (`Ctrl+Enter` aplica, `Esc` cancela).
- **Exportação pronta para PFCG e chamados**:
  - Cópia rápida para área de transferência, download em **`.TXT`** e exportação em **Excel (`.XLSX`)** com filtros automáticos e abas **Log Consolidado**, **Por Usuário** (quando multiusuário) e **Resumo**.
- **Histórico local com backup**:
  - Armazena até 8 sessões recentes no `localStorage` do navegador, com restauração em um clique, limpeza manual e botão **Exportar** para backup em `.JSON`.

---

## Tecnologias Utilizadas

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide React
- **Build & Tooling**: Vite 8
- **Processamento Local**: `tesseract.js` (`@tesseract.js-data/eng`), `pdfjs-dist`, `xlsx`
- **Servidor Local (opcional)**: Express (`server.ts`) para execução em ambiente Node.js

---

## Como Executar Localmente

### Pré-requisitos
- **Node.js** 20+ (ou **Bun** 1.3+)

### Instalação e desenvolvimento

```bash
# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento (http://localhost:3000)
npm run dev
```

### Build de produção

```bash
# Gerar bundle estático autocontido em dist/
npm run build

# Checagem de tipos TypeScript
npm run lint
```

Durante o `vite build`, os arquivos locais do OCR (`/tesseract/*`) e do worker de PDF (`/pdfjs/*`) são copiados automaticamente para `dist/`, tornando a pasta final pronta para qualquer hospedagem estática.

---

## Deploy

O projeto já inclui configurações prontas para publicação estática gratuita (sem necessidade de funções serverless):

- **Vercel** (`vercel.json`):
  - Framework: `Vite` · Build Command: `npm run build` · Output Directory: `dist`
  - Cache longo configurado para bundles e assets pesados de OCR/PDF.
- **Cloudflare Pages / Workers Static Assets** (`wrangler.jsonc` e `public/_headers`):
  - **Pages**: Build command `npm run build` · Output directory `dist`
  - **Workers Static Assets**: Build command `bun install && bun run build` · Deploy command `npx wrangler deploy`

---

## Segurança & Privacidade

- Nenhum arquivo HTML, PDF, imagem ou dado de autorização SAP sai do navegador do analista.
- Arquivos HTML importados são lidos em documento isolado (sem execução de scripts) e renderizados apenas como texto seguro.
- Cabeçalhos de segurança (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) configurados para hospedagem estática e Express.
- Em computadores compartilhados, utilize o botão **Limpar histórico local** no modal de histórico ao finalizar o atendimento.
