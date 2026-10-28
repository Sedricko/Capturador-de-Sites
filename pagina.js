// Funções injetadas na página visitada. Cada uma retorna na hora e manda o resultado depois por mensagem
// ({ resultado: id }), para nenhuma chamada do service worker ficar presa esperando minutos.

// Prepara a página sem rolar: o conteúdo adiado (lazy) quem carrega é o SingleFile, com os ganchos dele.
// Aqui só destravamos as imagens "lazy" mais comuns e devolvemos links, título e texto.
export function prepararPagina(carregarMais, id) {
	// relógio do service worker: setTimeout aqui fica a 1 por minuto quando a janela está minimizada
	const pausa = ms => chrome.runtime.sendMessage({ esperar: ms });
	const carregar = img => img.complete ? null : new Promise(r => { img.addEventListener("load", r); img.addEventListener("error", r); });
	(async () => {
		// scroll infinito: pula direto para o fim (sem rolar tela por tela) enquanto a página crescer; depois volta ao topo
		const pagina = document.scrollingElement || document.documentElement;
		for (let i = 0; i < 10; i++) {
			const altura = pagina.scrollHeight;
			scrollTo(0, altura);
			await pausa(1500);
			if (pagina.scrollHeight <= altura) break;
		}
		scrollTo(0, 0);
		// "Carregar mais"/"Ver mais": só botões (nunca links, que mudariam de página); para quando a página parar de crescer
		let cliques = 0;
		const TEXTO = /^\s*(carregar|ver|mostrar|exibir|load|show|see|view)\s+(mais|more)\b|mais resultados|more results/i;
		while (carregarMais && cliques < 10) {
			const botao = [...document.querySelectorAll("button, [role=button], input[type=button]")]
				.find(b => !b.disabled && b.offsetParent !== null && TEXTO.test(b.innerText || b.value || ""));
			if (!botao) break;
			const antes = document.body.innerHTML.length;
			botao.click();
			cliques++;
			await pausa(1500);
			if (document.body.innerHTML.length === antes) await pausa(2000);
			if (document.body.innerHTML.length === antes) break;
		}
		// imagens "lazy" (data-src e afins): troca o marcador pela imagem real
		for (const el of document.querySelectorAll("img, source")) {
			for (const [de, para] of [["data-src", "src"], ["data-srcset", "srcset"], ["data-lazy-src", "src"], ["data-lazy-srcset", "srcset"], ["data-original", "src"]]) {
				const valor = el.getAttribute(de);
				if (valor && el.getAttribute(para) !== valor) el.setAttribute(para, valor);
			}
			if (el.loading === "lazy") el.loading = "eager";
			// o CSS desses sites deixa "lazyload" com opacity 0 até o script deles marcar como carregada
			if (el.classList.contains("lazyload") || el.classList.contains("lazyloading")) {
				el.classList.remove("lazyload", "lazyloading");
				el.classList.add("lazyloaded");
			}
		}
		await Promise.race([Promise.all([...document.images].map(carregar)), pausa(20000)]);
		// texto para a busca da página inicial offline
		const texto = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 3000);
		// "próxima página" de listas paginadas (<link rel="next"> fica no <head>, fora de document.links)
		const links = [...document.links, ...document.querySelectorAll("link[rel~=next][href]")].map(a => a.href);
		// sinais para reconhecer o tipo de site (WordPress, wiki, loja…)
		const recursos = [...document.querySelectorAll("script[src], link[href]")].map(e => e.src || e.href).join(" ");
		const sinais = {
			gerador: document.querySelector("meta[name=generator]")?.content || "",
			host: location.hostname,
			marcas: [/wp-content|wp-includes/.test(recursos) && "wp-content", /cdn\.shopify\.com/.test(recursos) && "shopify"].filter(Boolean).join(" ")
		};
		return { links, titulo: document.title.trim(), texto, sinais, cliques };
	})().then(valor => chrome.runtime.sendMessage({ resultado: id, valor }), e => chrome.runtime.sendMessage({ resultado: id, erro: e.message }));
}

// Só os links e o título (para páginas já salvas, sem rolar nem capturar).
export function coletarLinks(id) {
	chrome.runtime.sendMessage({ resultado: id, valor: { links: [...document.links].map(a => a.href), titulo: document.title.trim() } });
}

// O SingleFile monta um .html único com imagens, CSS e fontes embutidos.
export function capturar(seletorAnuncio, id) {
	const buscar = async (url, opcoes = {}) => {
		try {
			const r = await fetch(url, { cache: "force-cache", headers: opcoes.headers, signal: AbortSignal.timeout(30000) });
			if (r.ok) return r;
		} catch { /* outro domínio sem CORS: pede à extensão */ }
		const r = await chrome.runtime.sendMessage({ buscar: url, headers: opcoes.headers });
		if (!r || r.erro) throw new Error(r ? r.erro : "sem resposta");
		const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
		return { status: r.status, headers: new Headers(r.headers), arrayBuffer: async () => bytes.buffer };
	};
	globalThis.singlefile.getPageData({
		// conteúdo adiado (lazy): os ganchos do SingleFile fazem o site carregar tudo sem rolar a página
		loadDeferredContent: true,
		loadDeferredContentMaxIdleTime: 1500,
		loadDeferredContentDispatchScrollEvent: true,
		loadDeferredContentKeepZoomLevel: false,
		removeFrames: false, // iframes (vídeos, mapas, widgets) entram no arquivo
		blockScripts: true, // scripts não funcionam offline e eram ~80% do tamanho das páginas (Fandom)
		removeHiddenElements: false, // menus suspensos ficam escondidos até passar o mouse
		removeUnusedStyles: false, // mantém os estilos de :hover dos menus
		removeUnusedFonts: true,
		removedElementsSelector: seletorAnuncio,
		removeAlternativeFonts: true,
		removeAlternativeMedias: true,
		removeAlternativeImages: true,
		groupDuplicateImages: true,
		maxSizeDuplicateImages: 512 * 1024,
		compressHTML: true,
		insertCanonicalLink: false
	}, { fetch: buscar, frameFetch: buscar })
		.then(p => chrome.runtime.sendMessage({ resultado: id, valor: p.content }), e => chrome.runtime.sendMessage({ resultado: id, erro: e.message }));
}
