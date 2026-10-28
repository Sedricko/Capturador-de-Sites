# Capturador de Sites

Extensão do Chrome que salva **sites inteiros para navegar offline**, página por página, em segundo plano.
Cada página vira um `.html` único (imagens, CSS e fontes embutidos), os links entre páginas passam a apontar
para os arquivos locais, e uma página inicial (`00-INICIO.html`) mostra o esqueleto do site com busca.

## Instalar

1. Baixe este repositório (Code → Download ZIP) e descompacte.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor** e clique em **Carregar sem compactação**.
3. Selecione a pasta descompactada.

Para atualizar: substitua os arquivos e clique em **recarregar** na extensão. Não use "Remover" — isso apaga
a pasta de destino, os agendamentos e o índice que a extensão guarda.

## Usar

- **Clique no ícone** para abrir o painel: cole as páginas, escolha "O site inteiro" ou "Só estas páginas",
  escolha a pasta de destino e clique em **Iniciar captura**. Pode minimizar ou fechar o painel; a captura continua.
- **Botão direito** em qualquer página: *Capturar só esta página*, *Capturar este site inteiro* ou *Salvar esta página em PDF*.
- No fim, abra `00-INICIO.html` na pasta do site (ou `00-SITES.html` para ver todos os sites capturados).

## O que ela faz

| Captura | Navegação offline | Automação |
|---|---|---|
| Carrega conteúdo adiado (lazy) sem rolar a página | Links entre páginas apontam para os arquivos locais | Reconhece o tipo de site (wiki, WordPress, loja, fórum) e ajusta as regras |
| Captura iframes, remove anúncios | Página inicial com abas "Início" e "Esqueleto do site" | Lê o mapa do site (sitemap) |
| Baixa arquivos linkados (PDF, ZIP…) — opcional | Busca por título e pelo texto das páginas | Tenta de novo as páginas que falharem |
| Pula páginas de sistema, login e repetidas (`utm_`…) | Aviso "não capturada" no lugar de links quebrados | Continua sozinha se o Chrome fechar no meio |
| Pular já salvas / atualizar só as que mudaram | Pasta igual à estrutura do site | Agendamento diário ou semanal |

## Como é organizado

| Arquivo | Papel |
|---|---|
| `painel.html` / `painel.js` | Tela de configuração e progresso (só interface) |
| `motor.html` / `motor.js` | Motor da captura, num documento offscreen (o Chrome não o congela em segundo plano) |
| `background.js` | Service worker: comandos do Chrome, menus, agendamentos, PDF, serviços do SingleFile |
| `pagina.js` | Funções injetadas na página visitada (preparar, coletar links, capturar) |
| `regras.js` | Regras puras: endereços, nomes de arquivo, índice, perfis de site, sitemap, agenda |
| `vendor/` | Arquivos do [SingleFile](https://github.com/gildas-lormeau/SingleFile) 1.32.0, sem alterações (AGPL v3) |

## Testes

```
node teste.mjs
```

Testa as regras de `regras.js` (endereços, nomes de arquivo, índice, perfis, sitemap, agenda).

## Limites conhecidos

- Scripts não são salvos: busca do site, login, comentários e menus que só abrem com clique não funcionam offline.
- Agendamentos e a retomada automática precisam do Chrome aberto.
- Depois de reiniciar o Chrome, ele pode pedir um clique para liberar de novo a pasta de destino.
- Botões "carregar mais" não são clicados; sitemaps `.gz` não são lidos.

## Licença

Uso particular. Os arquivos em `vendor/` são do SingleFile (Gildas Lormeau), licença GNU AGPL v3 — ver `vendor/LEIA-ME.txt`.
