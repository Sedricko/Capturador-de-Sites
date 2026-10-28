# Capturador de Sites

Extensão do Chrome que salva **sites inteiros para navegar offline**, página por página, em segundo plano.
Cada página vira um `.html` único (imagens, CSS e fontes embutidos), os links entre páginas passam a apontar
para os arquivos locais, e uma página inicial (`00-INICIO.html`) mostra o esqueleto do site com busca.

📘 **Tutorial completo (PDF):** [`docs/Tutorial-Capturador-de-Sites.pdf`](docs/Tutorial-Capturador-de-Sites.pdf) — como usar e para que serve cada função.

## Instalar

1. Baixe este repositório (Code → Download ZIP) e descompacte.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta descompactada.

Para atualizar: substitua os arquivos e clique em **recarregar** na extensão. Não use "Remover" — isso apaga
a pasta de destino, os agendamentos e o índice que a extensão guarda.

## Usar

- **Clique no ícone** para abrir o painel. Ele tem quatro abas:
  - **🚀 Capturar** — páginas, modo (site inteiro / só estas), pasta e o que gerar no final (livro PDF, .zip, miniaturas).
  - **🤖 Automação** — reconhecer o tipo de site, sitemap, "carregar mais", novas tentativas, retomada e agendamentos.
  - **🗂️ Meus sites** — sites já capturados, com *Atualizar agora*, *.zip*, *Livro PDF* e *Esquecer*.
  - **⚙️ Opções** — páginas ao mesmo tempo (1–4), pausa, limites, arquivos repetidos, máquina do tempo e filtros.
  Iniciar/Parar e o progresso ficam sempre visíveis. Pode minimizar ou fechar o painel; a captura continua.
- **Botão direito** em qualquer página: *Capturar este site inteiro*, *Capturar só esta página*, *Salvar esta página em PDF* ou *Abrir o painel*.
- No fim, abra `00-INICIO.html` na pasta do site (ou `00-SITES.html` para ver todos os sites capturados).

## O que ela faz

| Captura | Navegação offline | Automação |
|---|---|---|
| Carrega conteúdo adiado (lazy) sem rolar a página | Links entre páginas apontam para os arquivos locais | Reconhece o tipo de site (wiki, WordPress, loja, fórum) e ajusta as regras |
| Captura iframes, remove anúncios | Página inicial com abas "Início" e "Esqueleto do site" | Lê o mapa do site (sitemap) |
| Baixa arquivos linkados (PDF, ZIP…) — opcional | Busca por título e pelo texto das páginas | Tenta de novo as páginas que falharem |
| Pula páginas de sistema, login e repetidas (`utm_`…) | Aviso "não capturada" no lugar de links quebrados | Continua sozinha se o Chrome fechar no meio |
| Pular já salvas / atualizar só as que mudaram | Pasta igual à estrutura do site | Agendamento diário ou semanal |
| Sem scripts; estilos e imagens repetidos guardados uma vez só (`_recursos/`) | 🕰️ Máquina do tempo: versões anteriores ao lado da página | Clica em "carregar mais" e segue o scroll infinito |
| 1 a 4 páginas ao mesmo tempo | Miniaturas das páginas na página inicial | 📕 Livro PDF do site e 📦 .zip no final |

## Como é organizado

| Arquivo | Papel |
|---|---|
| `painel.html` / `painel.js` | Tela de configuração e progresso (só interface) |
| `motor.html` / `motor.js` | Motor da captura, num documento offscreen (o Chrome não o congela em segundo plano) |
| `background.js` | Service worker: comandos do Chrome, menus, agendamentos, PDF, serviços do SingleFile |
| `pagina.js` | Funções injetadas na página visitada (preparar, coletar links, capturar) |
| `livro.html` / `livro.js` | Monta o livro do site (capa, sumário, páginas) para o Chrome imprimir em PDF |
| `regras.js` | Regras puras: endereços, nomes de arquivo, índice, perfis de site, sitemap, agenda, recursos, .zip |
| `vendor/` | Arquivos do [SingleFile](https://github.com/gildas-lormeau/SingleFile) 1.32.0, sem alterações (AGPL v3) |

## Testes

```
node teste.mjs
```

Testa as regras de `regras.js` (endereços, nomes de arquivo, índice, perfis, sitemap, agenda, recursos compartilhados, .zip).
O GitHub roda os mesmos testes sozinho a cada envio (`.github/workflows/testes.yml`).

## Limites conhecidos

- Scripts não são salvos: busca do site, login, comentários e menus que só abrem com clique não funcionam offline.
- Agendamentos e a retomada automática precisam do Chrome aberto.
- Depois de reiniciar o Chrome, ele pode pedir um clique para liberar de novo a pasta de destino.
- Sitemaps `.gz` não são lidos. Livro, .zip, miniaturas e máquina do tempo precisam de uma pasta escolhida.
- Livro e miniaturas usam o modo depuração do Chrome (aparece uma faixa enquanto trabalham). O livro junta até 300 páginas.

## Licença

Uso particular. Os arquivos em `vendor/` são do SingleFile (Gildas Lormeau), licença GNU AGPL v3 — ver `vendor/LEIA-ME.txt`.
