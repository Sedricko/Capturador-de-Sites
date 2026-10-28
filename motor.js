import { normalizar, reconhecerSite, lerSitemap, separarRecursos, aplicarRecursos, extensaoImagem, criarZip, nomeArquivo, caminhoRelativo, montarIndice, montarSites, arquivoLocal, paginaNaoCapturada, INDICE, SITES, ARQUIVOS, MARCA_NAO_CAPTURADA, DOMINIOS_ANUNCIO, SELETOR_ANUNCIO } from "./regras.js";

// Motor da captura (documento offscreen). Aqui só existe chrome.runtime: o resto é pedido ao service worker.
// Sem setTimeout: documentos escondidos têm os timers estrangulados; as esperas usam o relógio do service worker.

let parar = false, rodando = false, pasta = null;
const esperandoResultado = new Map();

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
	if (msg.motor === "iniciar" || msg.motor === "continuar") {
		// uma captura por vez: avisa em vez de ignorar
		if (rodando) return responder({ erro: `Já tem uma captura de ${estado.site} rodando.`, ocupado: true });
		rodar(msg.trabalho);
		responder("ok");
	}
	if (msg.motor === "zip" || msg.motor === "livro") {
		if (rodando) return responder({ erro: `Já tem uma captura de ${estado.site} rodando.`, ocupado: true });
		tarefaAvulsa(msg.motor, msg.host);
		responder("ok");
	}
	if (msg.livroPronto) esperandoResultado.get("livro:" + msg.livroPronto)?.(msg);
	if (msg.motor === "parar") {
		parar = true;
		progresso({ status: "Parando após a página atual…" });
		responder("ok");
	}
	if (msg.resultado) esperandoResultado.get(msg.resultado)?.(msg);
	if (msg.motor === "baixarPdf") {
		const bytes = Uint8Array.from(atob(msg.base64), c => c.charCodeAt(0));
		// shortcut: o blob URL não é revogado (timers estrangulados aqui); vive até o motor fechar
		rpc("baixar", URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), msg.nome, "uniquify").then(() => responder("ok"), e => responder({ erro: e.message }));
		return true;
	}
	if (msg.buscar) {
		baixarRecurso(msg.buscar, msg.headers).then(responder, e => responder({ erro: e.message }));
		return true;
	}
});

async function rpc(nome, ...args) {
	const r = await chrome.runtime.sendMessage({ rpc: nome, args });
	if (!r) throw new Error(`sem resposta do service worker (${nome})`);
	if (r.erro) throw new Error(r.erro);
	return r.valor;
}

// Progresso guardado no storage: o painel (se estiver aberto) mostra ao vivo.
let linhas = [];
let estado = {};
function progresso(mudancas) {
	estado = { ...estado, ...mudancas };
	return rpc("set", { progresso: { ...estado, linhas: linhas.slice(-300) } }).catch(() => {});
}
function log(msg) {
	linhas.push(msg);
	return progresso({});
}

// Roda uma função de pagina.js na aba e espera a resposta dela (com limite de tempo).
let contador = 0;
async function naPagina(abaId, nome, args, limiteMs) {
	const id = `r${Date.now()}-${contador++}`;
	let resposta = null;
	esperandoResultado.set(id, m => { resposta = m; });
	try {
		await rpc("pagina", abaId, nome, [...args, id]);
		for (const inicio = Date.now(); !resposta && Date.now() - inicio < limiteMs;) await rpc("esperar", 500);
	} finally {
		esperandoResultado.delete(id);
	}
	if (!resposta) throw new Error(`a página não respondeu em ${Math.round(limiteMs / 60000)} min`);
	if (resposta.erro) throw new Error(resposta.erro);
	return resposta.valor;
}

// Navega e espera o carregamento; se demorar demais (45 s), captura o que já carregou.
async function abrir(abaId, url) {
	const antes = (await rpc("estadoAba", abaId)).url;
	await rpc("navegar", abaId, url);
	let carregando = false;
	for (const inicio = Date.now(); Date.now() - inicio < 45000;) {
		await rpc("esperar", 300);
		const aba = await rpc("estadoAba", abaId);
		if (aba.status === "loading") carregando = true;
		// "complete" ainda da página anterior não conta: só depois de começar a carregar a nova (ou de o endereço mudar)
		if (aba.status === "complete" && (carregando || aba.url !== antes)) return aba.url;
	}
	return url;
}

async function rodar(t) {
	rodando = true;
	parar = false;
	pasta = await lerPasta();
	if (!await pastaLiberada()) { rodando = false; return; }
	const continuando = t.n > 0 || t.capturadas.length > 0;
	linhas = continuando ? [`↻ Continuando: ${t.n} já salvas, ${t.fila.length} na fila.`] : [];
	await progresso({ rodando: true, status: "Começando…", site: new URL(t.fila[0] || t.config.prefixo).hostname, feitas: t.n, total: t.n + t.fila.length, eta: null });
	// configs antigas (antes da 4.1) tinham só "pular"; as opções novas valem "ligado" quando não vierem
	const { seguir, prefixo, max, pausa, excluir = [], profundidade = 0, arquivos = false, autoPerfil = true, sitemap = true, retentar = true,
		paralelas = 2, recursos = true, versoes = true, miniaturas = false, livro = false, zip = false, carregarMais = true } = t.config;
	const existentes = t.config.existentes || (t.config.pular ? "pular" : "recapturar");
	const regras = [...excluir]; // cresce com as exclusões do tipo de site reconhecido
	let perfil = t.perfil || null, sitemapFeito = !!t.sitemapFeito;
	const tentativas = t.tentativas || {}, aRetentar = t.aRetentar || [];
	let rodadasDeNovo = t.rodadasDeNovo || 0, esperandoNovaRodada = false;
	const fila = t.fila, vistos = new Set(t.vistos), capturadas = new Map(t.capturadas), prof = t.profundidades || {};
	const baixados = new Map(); // arquivo linkado → caminho local (nesta captura)
	let n = t.n, puladas = 0, ocupadas = 0; // ocupadas: páginas em andamento agora (várias abas)
	const tempos = []; // duração de cada página capturada, para a estimativa de tempo
	// janelas de captura que ficaram órfãs (painel/Chrome fechado no meio)
	for (const j of t.janelas || (t.janelaId ? [{ janelaId: t.janelaId, abaId: t.abaId }] : [])) await rpc("fecharJanela", j.janelaId, j.abaId);
	await rpc("ganchos", true); // antes de abrir as páginas: os ganchos precisam entrar desde o começo do carregamento
	const janelas = [];
	const novaJanela = async () => {
		const j = await rpc("janela");
		if (miniaturas) await rpc("depurar", j.abaId, true).catch(e => log("✖ miniaturas — " + e.message));
		return j;
	};
	for (let i = 0; i < Math.max(1, Math.min(4, paralelas)); i++) janelas.push(await novaJanela());
	// progresso guardado a cada página: fechar o painel ou o Chrome não perde o que já foi feito
	const guardar = () => rpc("set", { trabalho: { config: { ...t.config, excluir: regras }, fila, vistos: [...vistos], capturadas: [...capturadas], profundidades: prof, n, janelas, perfil, sitemapFeito, tentativas, aRetentar, rodadasDeNovo } });
	await guardar();
	// só entra na fila o que vai ser capturado: fora do prefixo, excluído ou fundo demais continua apontando para o site
	const seguirLinks = (links, d) => {
		if (!seguir || (profundidade && d + 1 > profundidade)) return;
		for (const link of links) {
			const u = normalizar(link, prefixo, regras);
			if (u && !vistos.has(u)) { vistos.add(u); fila.push(u); prof[u] = d + 1; }
		}
	};
	const restantes = () => Math.min(fila.length, max - n);

	async function capturarUma(j, url) {
		const d = prof[url] || 0;
		const media = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length / janelas.length : null;
		await progresso({ status: `Salvas ${n} · fila ${fila.length} · ${url}`, feitas: n, total: n + ocupadas + restantes(), eta: media && media * (ocupadas + restantes()) });
		if (existentes !== "recapturar" && await jaSalva(url) && (existentes === "pular" || !await mudou(url))) {
			// já salva: no modo site inteiro só abre para achar os links (sem capturar)
			let titulo = capturadas.get(url)?.titulo || url;
			if (seguir) {
				await abrir(j.abaId, url);
				const r = await naPagina(j.abaId, "coletarLinks", [], 30000);
				titulo = r.titulo || titulo;
				seguirLinks(r.links, d);
			}
			capturadas.set(url, { ...capturadas.get(url), arquivo: nomeArquivo(url), titulo });
			puladas++;
			await log(`↷ já salva${existentes === "mudou" ? " e sem mudanças" : ""}  ${url}`);
			return;
		}
		const inicio = Date.now();
		const final = await abrir(j.abaId, url);
		vistos.add(normalizar(final, prefixo, regras));
		const { links, titulo, texto, sinais, cliques } = await naPagina(j.abaId, "prepararPagina", [carregarMais], 90000);
		if (cliques) await log(`  ➕ cliquei ${cliques}× em "carregar mais"  ${url}`);
		if (autoPerfil && !perfil && sinais) {
			// reconhece o tipo de site na 1ª página e aplica as regras dele (também ao que já está na fila)
			const achado = reconhecerSite(sinais);
			perfil = achado?.nome || "genérico";
			if (achado) {
				regras.push(...achado.excluir.filter(r => !regras.includes(r)));
				for (let i = fila.length - 1; i >= 0; i--) if (!normalizar(fila[i], prefixo, regras)) fila.splice(i, 1);
				await log(`🧠 Site reconhecido: ${achado.nome} — regras ajustadas sozinhas (não visitar: ${achado.excluir.join(", ")})`);
			}
		}
		seguirLinks(links, d);
		if (seguir && sitemap && !sitemapFeito) {
			sitemapFeito = true;
			const achadas = await lerMapaDoSite(prefixo).catch(() => []);
			const antes = fila.length;
			seguirLinks(achadas, 0);
			if (achadas.length) await log(`🗺️ Mapa do site: ${achadas.length} endereços encontrados, ${fila.length - antes} páginas novas na fila.`);
		}
		await rpc("singlefile", j.abaId);
		const html = await naPagina(j.abaId, "capturar", [SELETOR_ANUNCIO], 3 * 60000);
		const miniatura = miniaturas ? await salvarMiniatura(j.abaId, url).catch(() => undefined) : capturadas.get(url)?.miniatura;
		const locais = arquivos ? await baixarArquivos(links, new URL(url).hostname, baixados) : baixados;
		let pronto = religar(html, url, final, vistos, locais);
		if (recursos) pronto = await compartilharRecursos(pronto, url);
		const historico = versoes ? await guardarVersaoAnterior(url, texto) : [];
		await salvar(nomeArquivo(url), new Blob([pronto], { type: "text/html" }));
		capturadas.set(url, { arquivo: nomeArquivo(url), titulo: titulo || url, texto, salvoEm: Date.now(), miniatura, versoes: historico });
		tempos.push(Date.now() - inicio);
		await log(`✔ ${++n}  ${url}`);
		await rpc("badge", String(n));
		// índice já existe desde o começo e vai crescendo (se o Chrome fechar no meio, ele não se perde)
		if (n === 1 || n % 10 === 0) await gerarIndices(capturadas, seguir ? fila : [], false).catch(e => log("✖ índice — " + e.message));
	}

	// Cada aba de captura é um "trabalhador" puxando da mesma fila.
	async function trabalhador(j) {
		let reaberturas = 0;
		while (!parar && n + ocupadas < max) {
			if (!fila.length) {
				// outras abas ainda podem achar links novos; só termina quando todas pararem
				if (ocupadas || esperandoNovaRodada) { await rpc("esperar", 500); continue; }
				// fila acabou: as que falharam ganham nova chance (até 2 rodadas), depois de uma pausa
				if (!retentar || !aRetentar.length || rodadasDeNovo >= 2) break;
				esperandoNovaRodada = true;
				rodadasDeNovo++;
				await log(`↻ Tentando de novo ${aRetentar.length} página(s) que falharam (rodada ${rodadasDeNovo} de 2)…`);
				for (let i = 0; i < 3 && !parar; i++) await rpc("esperar", 10000);
				fila.push(...aRetentar.splice(0));
				esperandoNovaRodada = false;
				continue;
			}
			const url = fila.shift();
			ocupadas++;
			try {
				await capturarUma(j, url);
				reaberturas = 0;
			} catch (e) {
				if (/No tab with id/i.test(e.message) && reaberturas++ < 3) {
					// a janela de captura foi fechada: abre outra e tenta esta mesma página de novo
					Object.assign(j, await novaJanela());
					fila.unshift(url);
					await log(`↻ Uma janela de captura foi fechada; abri outra para continuar (não precisa fechá-la, ela fica minimizada).`);
					continue;
				}
				tentativas[url] = (tentativas[url] || 0) + 1;
				const deNovo = retentar && tentativas[url] <= 2;
				if (deNovo) aRetentar.push(url);
				await log(`✖ ${url} — ${e.message}${deNovo ? " (vou tentar de novo no fim)" : ""}`);
			} finally {
				ocupadas--;
			}
			await guardar();
			await rpc("esperar", pausa);
		}
	}

	try {
		await Promise.all(janelas.map(trabalhador));
	} finally {
		for (const j of janelas) await rpc("fecharJanela", j.janelaId, j.abaId).catch(() => {});
		await rpc("ganchos", false).catch(() => {});
	}
	await gerarIndices(capturadas, seguir ? fila : []).catch(e => log("✖ índice — " + e.message));
	let status;
	if (!fila.length || n >= max) {
		// terminou de verdade: não há o que continuar. O que ficou na fila ganha uma página "não capturada" local.
		if (fila.length) await marcarNaoCapturadas(fila).catch(e => log("✖ páginas não capturadas — " + e.message));
		await rpc("remove", "trabalho");
		const hosts = [...new Set([...capturadas.keys()].map(u => new URL(u).hostname))];
		for (const host of hosts) {
			if (livro) await gerarLivro(host).catch(e => log("✖ livro PDF — " + e.message));
			if (zip) await exportarZip(host).catch(e => log("✖ .zip — " + e.message));
		}
		await rpc("badge", "✔");
		status = `Fim: ${n} páginas salvas${puladas ? ` (+${puladas} já existiam)` : ""} em ${pasta ? pasta.name : "Downloads/capturas"}. Abra o ${INDICE} na pasta do site. ${fila.length} ficaram na fila.`;
		const falharam = Object.keys(tentativas).filter(u => !capturadas.has(u)).length;
		if (falharam) status += ` ${falharam} página(s) falharam mesmo depois das novas tentativas.`;
		await rpc("notificar", "Capturador: captura concluída ✔", `${n} páginas salvas${puladas ? `, ${puladas} já existiam` : ""}${falharam ? `, ${falharam} com erro` : ""}.`);
	} else {
		await rpc("badge", "⏸");
		status = `⏸ Pausada: ${n} salvas, ${fila.length} na fila. Para continuar, abra o painel e clique em "Continuar de onde parou".`;
		await rpc("notificar", "Capturador: captura pausada ⏸", `${n} salvas, ${fila.length} na fila. Clique no ícone para continuar.`);
	}
	linhas.push(status);
	rodando = false;
	await progresso({ rodando: false, status, feitas: n, total: n + (fila.length && n < max ? fila.length : 0), eta: null });
}

// A pasta escolhida precisa estar liberada (o Chrome pede um clique depois de reiniciar).
async function pastaLiberada() {
	if (!pasta || await pasta.queryPermission({ mode: "readwrite" }) === "granted") return true;
	linhas = ["Sem permissão para gravar na pasta escolhida. Abra o painel e clique em Iniciar/Continuar (o Chrome pede para liberar a pasta)."];
	await progresso({ rodando: false, status: linhas[0] });
	await rpc("notificar", "Capturador: falta liberar a pasta", "Abra o painel e clique em Iniciar ou Continuar.");
	return false;
}

// Estilos grandes e imagens embutidas viram arquivos em _recursos/, um por conteúdo (compartilhado entre páginas).
const gravados = new Set();
async function compartilharRecursos(html, url) {
	const host = new URL(url).hostname, atual = nomeArquivo(url);
	const { estilos, imagens } = separarRecursos(html);
	const caminhos = new Map();
	const gravar = async (bytes, extensao) => {
		const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
		const caminho = `capturas/${host}/_recursos/${hash}.${extensao}`;
		if (!gravados.has(caminho) && !await existe(caminho)) await salvar(caminho, new Blob([bytes]));
		gravados.add(caminho);
		return caminhoRelativo(atual, caminho);
	};
	for (const css of estilos) caminhos.set(css, await gravar(new TextEncoder().encode(css), "css"));
	for (const uri of imagens) caminhos.set(uri, await gravar(Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), c => c.charCodeAt(0)), extensaoImagem(uri)));
	return aplicarRecursos(html, caminhos);
}

// Máquina do tempo: se o texto da página mudou desde a captura anterior, a versão antiga fica ao lado,
// como <nome>.versao-AAAA-MM-DD_HH-MM.html (mesma pasta: os links e recursos dela continuam funcionando).
async function guardarVersaoAnterior(url, textoNovo) {
	const chave = "paginas:" + new URL(url).hostname;
	const antes = ((await rpc("get", chave))[chave] || {})[url];
	const historico = antes?.versoes || [];
	if (!pasta || !antes?.texto || antes.texto === textoNovo || !await existe(nomeArquivo(url))) return historico;
	const quando = new Date(antes.salvoEm || Date.now());
	const carimbo = quando.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
	const caminho = nomeArquivo(url).replace(/\.html$/, `.versao-${carimbo}.html`);
	await salvar(caminho, await lerArquivo(nomeArquivo(url)));
	await log(`  🕰️ a página mudou: versão anterior guardada (${quando.toLocaleString("pt-BR")})`);
	return [...historico, { data: quando.toLocaleString("pt-BR").slice(0, 17), arquivo: caminho.split("/").slice(2).join("/") }];
}

// Miniatura da página (para os cartões da página inicial offline), pelo modo depuração da aba.
async function salvarMiniatura(abaId, url) {
	let dados = null;
	const pedido = rpc("miniatura", abaId).then(d => { dados = d; });
	// a captura de tela pode não responder com a janela minimizada: espera no máximo 10 s
	for (let i = 0; i < 20 && dados === null; i++) await Promise.race([pedido, rpc("esperar", 500)]);
	if (!dados) throw new Error("sem miniatura");
	const caminho = nomeArquivo(url).replace(/^capturas\/([^/]+)\//, "capturas/$1/_miniaturas/").replace(/\.html$/, ".jpg");
	await salvar(caminho, new Blob([Uint8Array.from(atob(dados), c => c.charCodeAt(0))], { type: "image/jpeg" }));
	return caminho.split("/").slice(2).join("/");
}

// Livro PDF do site: livro.html monta as páginas salvas; o Chrome imprime tudo num PDF só (com marcadores).
async function gerarLivro(host) {
	if (!pasta) return log("✖ livro PDF — precisa de uma pasta escolhida no painel.");
	await log(`📕 Montando o livro PDF de ${host}…`);
	const { janelaId, abaId } = await rpc("janela");
	try {
		let pronto = null;
		esperandoResultado.set("livro:" + host, m => { pronto = m; });
		await rpc("navegar", abaId, chrome.runtime.getURL(`livro.html?host=${encodeURIComponent(host)}`));
		for (const inicio = Date.now(); !pronto && Date.now() - inicio < 10 * 60000;) await rpc("esperar", 1000);
		esperandoResultado.delete("livro:" + host);
		if (!pronto) throw new Error("o livro não ficou pronto em 10 min");
		if (pronto.erro) throw new Error(pronto.erro);
		await rpc("depurar", abaId, true);
		const pdf = await rpc("imprimirPdf", abaId);
		await salvar(`capturas/${host}/livro-${host}.pdf`, new Blob([Uint8Array.from(atob(pdf), c => c.charCodeAt(0))], { type: "application/pdf" }));
		await log(`📕 Livro PDF pronto: ${host}/livro-${host}.pdf (${pronto.paginas} páginas do site)`);
	} finally {
		await rpc("depurar", abaId, false).catch(() => {});
		await rpc("fecharJanela", janelaId, abaId).catch(() => {});
	}
}

// .zip do site inteiro, na pasta escolhida (ao lado da pasta do site).
// shortcut: monta o zip na memória; sites de vários GB podem não caber — aí gerar por partes.
async function exportarZip(host) {
	if (!pasta) return log("✖ .zip — precisa de uma pasta escolhida no painel.");
	await log(`📦 Gerando ${host}.zip…`);
	const arquivos = [];
	const andar = async (dir, prefixo) => {
		for await (const [nome, h] of dir.entries()) {
			if (h.kind === "directory") await andar(h, `${prefixo}${nome}/`);
			else arquivos.push({ nome: prefixo + nome, dados: new Uint8Array(await (await h.getFile()).arrayBuffer()) });
		}
	};
	await andar(await pasta.getDirectoryHandle(host), `${host}/`);
	await salvar(`capturas/${host}.zip`, new Blob([await criarZip(arquivos)], { type: "application/zip" }));
	await log(`📦 ${host}.zip pronto na pasta ${pasta.name} (${arquivos.length} arquivos).`);
}

// Tarefas avulsas pedidas pelo painel ("Meus sites"): livro PDF e .zip de um site já capturado.
async function tarefaAvulsa(nome, host) {
	rodando = true;
	pasta = await lerPasta();
	try {
		if (!await pastaLiberada()) return;
		linhas = [];
		await progresso({ rodando: true, site: host, status: nome === "livro" ? "Montando o livro PDF…" : "Gerando o .zip…", total: 0 });
		await (nome === "livro" ? gerarLivro(host) : exportarZip(host));
		linhas.push("Pronto.");
		await rpc("notificar", `Capturador: ${nome === "livro" ? "livro PDF" : ".zip"} pronto ✔`, host);
	} catch (e) {
		await log(`✖ ${e.message}`);
	} finally {
		rodando = false;
		await progresso({ rodando: false, status: linhas.at(-2) || linhas.at(-1) || "" });
	}
}

async function existe(caminho) {
	return !!pasta && !!await lerArquivo(caminho).catch(() => null);
}
async function lerArquivo(caminho) {
	const partes = caminho.split("/").slice(1);
	let dir = pasta;
	for (const nome of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(nome);
	return (await dir.getFileHandle(partes.at(-1))).getFile();
}

// Lê o mapa do site (robots.txt → Sitemap:, /sitemap.xml, /sitemap_index.xml), seguindo sitemaps aninhados.
// shortcut: sitemaps .xml.gz (compactados) são ignorados; descompactar com DecompressionStream se algum site precisar.
async function lerMapaDoSite(prefixo) {
	const origem = new URL(prefixo).origin;
	const texto = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); return r.ok ? r.text() : ""; };
	const aLer = [`${origem}/sitemap.xml`, `${origem}/sitemap_index.xml`];
	const robots = await texto(`${origem}/robots.txt`).catch(() => "");
	for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) aLer.unshift(m[1]);
	const lidos = new Set(), paginas = new Set();
	while (aLer.length && lidos.size < 30 && paginas.size < 50000) {
		const url = aLer.shift();
		if (lidos.has(url) || /\.gz$/i.test(url)) continue;
		lidos.add(url);
		const xml = await texto(url).catch(() => "");
		const r = lerSitemap(xml);
		r.paginas.forEach(p => paginas.add(p));
		aLer.push(...r.sitemaps);
	}
	return [...paginas];
}

// "Atualizar só o que mudou": pergunta ao site a data da última alteração (Last-Modified).
// Sem essa informação não dá para saber, então recaptura.
async function mudou(url) {
	const chave = "paginas:" + new URL(url).hostname;
	const salvoEm = ((await rpc("get", chave))[chave] || {})[url]?.salvoEm;
	if (!salvoEm) return true;
	try {
		const r = await fetch(url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20000) });
		const data = Date.parse(r.headers.get("last-modified"));
		return !(data <= salvoEm);
	} catch {
		return true;
	}
}

// Baixa os arquivos linkados (PDF, ZIP, imagens…) e devolve o mapa endereço → caminho local.
async function baixarArquivos(links, host, baixados) {
	for (const link of new Set(links)) {
		let u;
		try { u = new URL(link); } catch { continue; }
		u.hash = "";
		if (baixados.has(u.href) || !/^https?:$/.test(u.protocol) || !ARQUIVOS.test(u.pathname) || DOMINIOS_ANUNCIO.some(d => u.hostname.endsWith(d))) continue;
		try {
			const r = await fetch(u.href, { signal: AbortSignal.timeout(120000) });
			if (!r.ok) throw new Error("HTTP " + r.status);
			// shortcut: arquivos acima de 200 MB ficam online; subir o limite se precisar de vídeos grandes
			if (+r.headers.get("content-length") > 200e6) throw new Error("maior que 200 MB");
			const caminho = arquivoLocal(u.href, host);
			await salvar(caminho, await r.blob());
			baixados.set(u.href, caminho);
			await log(`  📎 ${u.href}`);
		} catch (e) {
			baixados.set(u.href, null); // não tenta de novo nesta captura
			await log(`  ✖ arquivo ${u.href} — ${e.message}`);
		}
	}
	return baixados;
}

// Páginas que ficaram na fila: um aviso local no lugar, para o link não dar erro offline.
async function marcarNaoCapturadas(fila) {
	for (const url of fila) if (!await jaSalva(url)) await salvar(nomeArquivo(url), new Blob([paginaNaoCapturada(url)], { type: "text/html" }));
	await log(`📭 ${fila.length} páginas da fila ganharam o aviso "não capturada" (o link abre o site online).`);
}

// Índice por site: junta com as capturas anteriores (guardadas no storage) e lista também o que ficou na fila.
async function gerarIndices(capturadas, pendentes, avisar = true) {
	// a página inicial do site é a primeira capturada dele (na 1ª captura do site)
	const primeira = host => [...capturadas.values()].find(p => p.arquivo.split("/")[1] === host)?.arquivo;
	const hosts = new Set([...capturadas.keys()].map(u => new URL(u).hostname));
	for (const host of hosts) {
		const chave = "paginas:" + host;
		const salvas = (await rpc("get", chave))[chave] || {};
		for (const [url, p] of capturadas) if (new URL(url).hostname === host) salvas[url] = { ...salvas[url], ...p };
		const chaveInicio = "inicio:" + host;
		const inicio = (await rpc("get", chaveInicio))[chaveInicio] || primeira(host);
		await rpc("set", { [chave]: salvas, [chaveInicio]: inicio });
		const paginas = Object.entries(salvas).map(([url, p]) => ({ url, ...p }));
		const faltam = pendentes.filter(u => new URL(u).hostname === host && !salvas[u])
			.map(url => ({ url, titulo: url, arquivo: nomeArquivo(url), online: true }));
		await salvar(`capturas/${host}/${INDICE}`, new Blob([montarIndice(host, [...paginas, ...faltam], inicio)], { type: "text/html" }));
		if (avisar) await log(`☰ Índice: ${host}/${INDICE}`);
	}
	const todos = await rpc("get", null);
	const sites = Object.keys(todos).filter(k => k.startsWith("paginas:")).map(k => ({ host: k.slice(8), total: Object.keys(todos[k]).length }));
	await salvar(`capturas/${SITES}`, new Blob([montarSites(sites)], { type: "text/html" }));
}

// O arquivo desta página já existe na pasta de destino? (sem pasta: consulta o registro das capturas)
async function jaSalva(url) {
	const caminho = nomeArquivo(url);
	if (!pasta) {
		const chave = "paginas:" + new URL(url).hostname;
		return Boolean(((await rpc("get", chave))[chave] || {})[url]);
	}
	try {
		const partes = caminho.split("/").slice(1);
		let dir = pasta;
		for (const nome of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(nome);
		const arquivo = await (await dir.getFileHandle(partes.at(-1))).getFile();
		// o aviso "não capturada" é pequeno e tem uma marca: não conta como salva
		return arquivo.size > 4000 || !(await arquivo.text()).includes(MARCA_NAO_CAPTURADA);
	} catch {
		return false;
	}
}

// Grava direto na pasta escolhida (sem janela de "salvar como"); sem pasta, usa Downloads/capturas.
async function salvar(caminho, blob) {
	if (!pasta) {
		// shortcut: o blob URL nunca é revogado (setTimeout aqui é estrangulado); vive até o motor fechar
		return rpc("baixar", URL.createObjectURL(blob), caminho);
	}
	const partes = caminho.split("/").slice(1); // a pasta escolhida faz o papel de "capturas"
	let dir = pasta;
	for (const nome of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(nome, { create: true });
	const arquivo = await (await dir.getFileHandle(partes.at(-1), { create: true })).createWritable();
	await arquivo.write(blob);
	await arquivo.close();
}

// A pasta escolhida no painel fica guardada no IndexedDB (mesma origem, então o motor também lê).
function banco() {
	return new Promise((ok, falha) => {
		const req = indexedDB.open("capturador", 1);
		req.onupgradeneeded = () => req.result.createObjectStore("config");
		req.onsuccess = () => ok(req.result);
		req.onerror = () => falha(req.error);
	});
}
async function lerPasta() {
	const db = await banco();
	return new Promise(ok => { const r = db.transaction("config").objectStore("config").get("pasta"); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); });
}

// Baixa imagens, CSS e fontes de outros domínios pela extensão, que não esbarra no bloqueio CORS da página.
async function baixarRecurso(url, headers) {
	if (DOMINIOS_ANUNCIO.some(d => new URL(url).hostname.endsWith(d))) throw new Error("anúncio bloqueado");
	const resposta = await fetch(url, { headers, cache: "force-cache", signal: AbortSignal.timeout(30000) });
	const bytes = new Uint8Array(await resposta.arrayBuffer());
	let binario = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return { status: resposta.status, headers: [...resposta.headers], base64: btoa(binario) };
}

// Troca links para páginas do site pelo caminho do arquivo salvo, para navegar offline.
// Só religa páginas que foram ou vão ser capturadas (salvas) e arquivos baixados (locais); o resto continua apontando para o site.
function religar(html, url, final, salvas, locais) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const atual = nomeArquivo(url);
	const base = new URL(doc.querySelector("base[href]")?.getAttribute("href") || final, final);
	for (const a of doc.querySelectorAll("a[href]")) {
		const href = a.getAttribute("href");
		if (href.startsWith("#")) continue;
		let alvo;
		try { alvo = new URL(href, base); } catch { continue; }
		const pagina = normalizar(alvo.href, "");
		if (pagina && salvas.has(pagina)) a.setAttribute("href", caminhoRelativo(atual, nomeArquivo(pagina)) + alvo.hash);
		const arquivo = locais.get(alvo.href.split("#")[0]);
		if (arquivo) a.setAttribute("href", caminhoRelativo(atual, arquivo));
	}
	const indice = doc.createElement("a");
	indice.href = caminhoRelativo(atual, `capturas/${new URL(url).hostname}/${INDICE}`);
	indice.textContent = "☰ Índice do site";
	indice.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#222;color:#fff;padding:8px 12px;border-radius:6px;font:14px sans-serif;text-decoration:none;opacity:.85";
	doc.body.append(indice);
	return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}
