// shortcut: arquivos não-HTML são pulados pela extensão da URL; para baixá-los também, tratar à parte.
const BINARIOS = /\.(pdf|zip|rar|7z|gz|exe|msi|dmg|iso|mp4|mp3|avi|mov|webm|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|woff2?|ttf)$/i;

// Páginas de sistema de wikis (MediaWiki/Fandom): não são conteúdo e não funcionam offline.
const SISTEMA_WIKI = /(^|\/)(Special|Especial|User|Usuário|Utilizador|User_blog|Talk|[^/:]*_talk|Discussão|File|Arquivo|Ficheiro|Template|Predefinição|MediaWiki|Module|Módulo|Message_Wall|Board|Thread|Blog):/i;
const LOGIN = /(^|\/)(signin|sign-in|login|logout|register|signup|sign-up|auth|oauth)(\/|$)/i;
const ACAO_WIKI = /[?&](action|oldid|diff|curid|printable|veaction|redlink|uselang|useskin)=/i;

const RASTREIO = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|igshid|yclid|ref_src|share)$/i;

// URL limpa (sem #) se deve ser visitada; null se não. "excluir": trechos (em minúsculas) que barram o endereço.
export function normalizar(href, prefixo, excluir = []) {
	let u;
	try { u = new URL(href); } catch { return null; }
	if (!/^https?:$/.test(u.protocol) || BINARIOS.test(u.pathname)) return null;
	u.hash = "";
	// parâmetros de rastreio (utm_, fbclid…) não mudam a página: sem eles, a mesma página não é salva duas vezes
	for (const nome of [...u.searchParams.keys()]) if (RASTREIO.test(nome)) u.searchParams.delete(nome);
	let caminho = u.pathname;
	try { caminho = decodeURIComponent(caminho); } catch { /* % inválido */ }
	// Special:AllPages fica: lista todas as páginas da wiki
	if ((SISTEMA_WIKI.test(caminho) && !/Special:AllPages$/i.test(caminho)) || ACAO_WIKI.test(u.search) || LOGIN.test(caminho) || /^\/f(\/|$)/.test(caminho)) return null;
	if (excluir.some(t => u.href.toLowerCase().includes(t))) return null;
	return u.href.startsWith(prefixo) ? u.href : null;
}

// Arquivos linkados que podem ser baixados junto (opção "Baixar arquivos linkados").
export const ARQUIVOS = /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|odt|ods|csv|txt|epub|mp3|mp4|jpe?g|png|gif|webp)$/i;

// Onde guardar um arquivo linkado: capturas/<site>/_arquivos/<host do arquivo>/<caminho>
export function arquivoLocal(url, host) {
	const u = new URL(url);
	let caminho = u.pathname;
	try { caminho = decodeURIComponent(caminho); } catch { /* % inválido */ }
	const partes = caminho.split("/").map(p => p.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "").slice(0, 80)).filter(Boolean);
	return ["capturas", host, "_arquivos", u.hostname, ...partes].join("/");
}

// Página local no lugar de uma que ficou na fila (limite de páginas): o link não quebra offline.
export const MARCA_NAO_CAPTURADA = "capturador-nao-capturada";
export function paginaNaoCapturada(url) {
	return `<!DOCTYPE html><html lang="pt-br"><head><meta charset="utf-8"><meta name="${MARCA_NAO_CAPTURADA}" content="1"><title>Página não capturada</title>
<style>body{font:16px system-ui,sans-serif;max-width:640px;margin:15vh auto;padding:0 16px;text-align:center;color:#333;background:#fff}a{color:#4f46e5}</style></head>
<body><h1>📭 Esta página não foi capturada</h1><p>Ela não entrou na cópia offline (por exemplo, pelo limite de páginas).</p>
<p><a href="${esc(url)}">Abrir online: ${esc(url)}</a></p><p><a href="javascript:history.back()">← Voltar</a></p></body></html>`;
}

// Perfis por tipo de site: reconhecidos pelos sinais da 1ª página, acrescentam exclusões que fazem sentido para ele.
// (Páginas de sistema de wiki já são barradas em normalizar.)
export const PERFIS = [
	{ nome: "Wiki (MediaWiki/Fandom)", sinal: s => /mediawiki/i.test(s.gerador) || /\.fandom\.com$|\.wikia\.com$/.test(s.host), excluir: ["/wiki/special:", "?action=", "&action=", "/index.php?"] },
	{ nome: "WordPress", sinal: s => /wordpress/i.test(s.gerador) || s.marcas.includes("wp-content"), excluir: ["/wp-admin", "/wp-login", "/wp-json", "/xmlrpc", "/feed", "?replytocom=", "/comment-page-", "?share=", "/trackback"] },
	{ nome: "Loja Shopify", sinal: s => s.marcas.includes("shopify"), excluir: ["/cart", "/account", "/checkout", "/search?", "?variant=", "/policies/"] },
	{ nome: "Fórum Discourse", sinal: s => /discourse/i.test(s.gerador), excluir: ["/login", "/signup", "/u/", "/my/", "?page=", "/print"] },
	{ nome: "Blogger", sinal: s => /blogger/i.test(s.gerador), excluir: ["?showcomment=", "/search?", "?m=1", "&m=1", "feeds/"] }
];
export const reconhecerSite = sinais => PERFIS.find(p => p.sinal(sinais)) || null;

// Endereços de um sitemap.xml: páginas (<url><loc>) e outros sitemaps (<sitemap><loc>).
export function lerSitemap(xml) {
	const locs = bloco => [...xml.matchAll(new RegExp(`<${bloco}>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>`, "gi"))].map(m => m[1].replace(/&amp;/g, "&"));
	return { paginas: locs("url"), sitemaps: locs("sitemap") };
}

// Próximo disparo de um agendamento ("dia" ou "semana", às HH:MM), em milissegundos.
export function proximoHorario(periodo, hora, agora = new Date()) {
	const [h, m] = hora.split(":").map(Number);
	const alvo = new Date(agora);
	alvo.setHours(h, m, 0, 0);
	if (alvo <= agora) alvo.setDate(alvo.getDate() + (periodo === "semana" ? 7 : 1));
	return alvo.getTime();
}

// Configuração usada quando a captura começa pelo botão direito (sem passar pelo painel).
export const CONFIG_PADRAO = { max: 2000, pausa: 1000, existentes: "recapturar", excluir: [], profundidade: 0, arquivos: false, autoPerfil: true, sitemap: true, retentar: true };

// Espelha as pastas do site: /blog/post-1 → capturas/site.com/blog/post-1.html, /blog/ → blog/index.html
export function nomeArquivo(url) {
	const u = new URL(url);
	let caminho = u.pathname;
	try { caminho = decodeURIComponent(caminho); } catch { /* % inválido: usa como veio */ }
	if (caminho.endsWith("/")) caminho += "index";
	const limpar = parte => parte.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+|[._]+$/g, "").slice(0, 80);
	const partes = caminho.split("/").map(limpar).filter(Boolean);
	let arquivo = (partes.pop() || "index").replace(/\.(html?|php|aspx?|jsp)$/i, "");
	if (u.search) arquivo += "_" + limpar(u.search.slice(1));
	return ["capturas", u.hostname, ...partes, arquivo + ".html"].join("/");
}

// Caminho de um arquivo salvo para outro, para os links funcionarem offline.
export function caminhoRelativo(de, para) {
	const a = de.split("/").slice(0, -1), b = para.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return "../".repeat(a.length - i) + b.slice(i).join("/");
}

// shortcut: lista curta das maiores redes de anúncio; para bloqueio completo, usar junto o uBlock Origin Lite.
export const DOMINIOS_ANUNCIO = ["doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
	"googletagservices.com", "amazon-adsystem.com", "adnxs.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
	"pubmatic.com", "rubiconproject.com", "openx.net", "adform.net", "smartadserver.com", "media.net", "moatads.com",
	"teads.tv", "sharethrough.com", "33across.com", "yieldmo.com", "adsrvr.org", "casalemedia.com", "popads.net", "propellerads.com"];

export const SELETOR_ANUNCIO = ["ins.adsbygoogle", "[id^='google_ads']", "[id^='div-gpt-ad']", "[data-ad-slot]", "[data-ad-unit]",
	".adsbygoogle", ".ad-container", ".ad-slot", ".ad-banner", ".advertisement", ".publicidade", ".anuncio",
	"[aria-label='Advertisement' i]", "[aria-label='Publicidade' i]",
	// Fandom embaralha as classes, mas mantém estes
	"[data-key='advertisement']", "[id$='_boxad']", "[id*='leaderboard' i]", "[id^='incontent_']", "#floor_adhesion"].join(",");

export const INDICE = "00-INICIO.html";
export const SITES = "00-SITES.html";

function esc(s) {
	return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
// "ARTIFACTS | Heroic Wiki | Fandom" → "ARTIFACTS"
const limparTitulo = t => t.split(" | ")[0].trim() || t;

const ESTILO = `
	:root { --fundo: #f3f4f8; --cartao: #fff; --texto: #1d2230; --suave: #6b7185; --cor: #4f46e5; --borda: #e2e4ec; }
	@media (prefers-color-scheme: dark) { :root { --fundo: #14161d; --cartao: #1e212b; --texto: #e8eaf2; --suave: #9aa0b4; --cor: #8b85ff; --borda: #2e3240; } }
	* { box-sizing: border-box; }
	body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--fundo); color: var(--texto); }
	header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; padding: 28px 16px 0; }
	.topo, main { max-width: 980px; margin: 0 auto; }
	.marca { opacity: .8; font-size: 13px; letter-spacing: .05em; text-transform: uppercase; }
	h1 { margin: 4px 0; font-size: 28px; word-break: break-all; }
	.info { opacity: .85; margin: 0 0 18px; }
	.abas { display: flex; gap: 4px; }
	.abas button { border: 0; background: rgba(255,255,255,.15); color: #fff; padding: 10px 18px; border-radius: 10px 10px 0 0; font-size: 15px; cursor: pointer; }
	.abas button.ativa { background: var(--fundo); color: var(--texto); font-weight: 600; }
	main { padding: 24px 16px 48px; }
	.cartao { background: var(--cartao); border: 1px solid var(--borda); border-radius: 14px; padding: 20px; margin-bottom: 16px; }
	.abrir { display: block; text-decoration: none; color: #fff; background: var(--cor); border-radius: 14px; padding: 26px; font-size: 22px; font-weight: 700; margin-bottom: 16px; }
	.abrir small { display: block; font-size: 14px; font-weight: 400; opacity: .85; }
	.grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
	.grade a { display: block; text-decoration: none; color: var(--texto); background: var(--cartao); border: 1px solid var(--borda); border-radius: 12px; padding: 14px; }
	.grade a:hover, .abrir:hover { filter: brightness(1.08); }
	h2 { font-size: 17px; margin: 24px 0 10px; }
	.grade b { display: block; font-size: 22px; color: var(--cor); }
	.mini { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top; border-radius: 8px; margin-bottom: 8px; background: var(--borda); }
	input { width: 100%; padding: 12px 14px; font-size: 15px; border: 1px solid var(--borda); border-radius: 10px; background: var(--cartao); color: var(--texto); margin-bottom: 16px; }
	ul { list-style: none; padding-left: 18px; margin: 4px 0; } main > .cartao > ul { padding-left: 0; }
	li { margin: 2px 0; } summary { cursor: pointer; font-weight: 600; padding: 2px 0; }
	summary small, .online small, .trecho { color: var(--suave); font-weight: 400; }
	a { color: var(--cor); } .online a { color: var(--suave); }
	[hidden] { display: none !important; }
`;

// Página inicial do site: aba "Início" (abrir o site) e aba "Esqueleto" (árvore de todas as páginas).
// As páginas "online" foram encontradas mas ainda não capturadas.
export function montarIndice(host, paginas, inicio) {
	const raiz = { pastas: {}, paginas: [] };
	for (const p of paginas) {
		const partes = p.arquivo.split("/").slice(2); // tira "capturas/host"
		const titulo = p.online ? decodeURI(new URL(p.url).pathname) : limparTitulo(p.titulo);
		const ns = titulo.match(/^([^:/ ]{2,30}):\S/); // Category:, Categoria:… viram uma pasta própria
		let no = raiz;
		for (const pasta of [...partes.slice(0, -1), ...(ns ? [ns[1]] : [])]) no = no.pastas[pasta] ??= { pastas: {}, paginas: [] };
		no.paginas.push({ ...p, titulo: ns ? titulo.slice(ns[0].length - 1) : titulo, href: p.online ? p.url : encodeURI(partes.join("/")) });
	}
	const contar = no => no.paginas.length + Object.values(no.pastas).reduce((t, f) => t + contar(f), 0);
	const ramo = no => "<ul>" +
		no.paginas.sort((a, b) => !!a.online - !!b.online || a.titulo.localeCompare(b.titulo)).map(p =>
			`<li class="p${p.online ? " online" : ""}"${p.texto ? ` data-t="${esc(p.texto.slice(0, 3000))}"` : ""}><a href="${esc(p.href)}">${esc(p.titulo)}</a>${p.online ? " <small>(não capturada, abre online)</small>" : ""}${(p.versoes || []).length ? ` <small>🕰️ ${p.versoes.map(v => `<a href="${esc(encodeURI(v.arquivo))}">${esc(v.data)}</a>`).join(" · ")}</small>` : ""}<small class="trecho"></small></li>`).join("") +
		Object.keys(no.pastas).sort().map(k =>
			`<li><details${no === raiz ? " open" : ""}><summary>📁 ${esc(k)} <small>(${contar(no.pastas[k])})</small></summary>${ramo(no.pastas[k])}</details></li>`).join("") +
		"</ul>";
	// atalhos da aba Início: as pastas do primeiro nível que tem mais de uma (no Fandom: wiki → Category…)
	let nivel = raiz;
	while (!nivel.paginas.length && Object.keys(nivel.pastas).length === 1) nivel = Object.values(nivel.pastas)[0];
	const secoes = Object.entries(nivel.pastas).sort((a, b) => contar(b[1]) - contar(a[1]));
	// shortcut: mostra só as 30 primeiras na aba Início; o resto fica no esqueleto
	const destaques = nivel.paginas.filter(p => !p.online).slice(0, 30);
	const salvas = paginas.filter(p => !p.online);
	const home = salvas.find(p => p.arquivo === inicio) || salvas[0];
	const hrefHome = home && encodeURI(home.arquivo.split("/").slice(2).join("/"));
	return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(host)} — cópia offline</title><style>${ESTILO}</style></head><body>
<header><div class="topo">
	<div class="marca">Cópia offline · <a href="../${SITES}" style="color:#fff">todos os sites</a></div>
	<h1>${esc(host)}</h1>
	<p class="info">${salvas.length} páginas salvas · ${paginas.length - salvas.length} encontradas e não capturadas · atualizado em ${new Date().toLocaleString("pt-BR")}</p>
	<nav class="abas"><button class="ativa" data-aba="inicio">🏠 Início</button><button data-aba="mapa">🗂️ Esqueleto do site</button></nav>
</div></header>
<main>
<section id="inicio">
	${home ? `<a class="abrir" href="${esc(hrefHome)}">▶ Abrir o site<small>${esc(limparTitulo(home.titulo))}</small></a>` : ""}
	${destaques.length ? `<h2>Páginas</h2><div class="grade">${destaques.map(p => `<a href="${esc(p.href)}">${p.miniatura ? `<img class="mini" src="${esc(encodeURI(p.miniatura))}" alt="" loading="lazy">` : ""}${esc(p.titulo)}</a>`).join("")}</div>` : ""}
	${destaques.length < nivel.paginas.filter(p => !p.online).length ? `<p><a href="#" data-aba-link="mapa">Ver todas as páginas no esqueleto →</a></p>` : ""}
	${secoes.length ? `<h2>Seções</h2><div class="grade">${secoes.map(([k, no]) => `<a href="#" data-pasta="${esc(k)}"><b>${contar(no)}</b>📁 ${esc(k)}</a>`).join("")}</div>` : ""}
</section>
<section id="mapa" hidden>
	<input id="busca" placeholder="🔍 Buscar pelo título ou por qualquer palavra do texto das páginas…">
	<div class="cartao">${ramo(raiz)}</div>
</section>
</main>
<script>
const abrirAba = nome => {
	document.querySelectorAll(".abas button").forEach(b => b.classList.toggle("ativa", b.dataset.aba === nome));
	document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== nome);
};
document.querySelectorAll(".abas button").forEach(b => b.onclick = () => abrirAba(b.dataset.aba));
document.querySelectorAll("[data-aba-link]").forEach(a => a.onclick = e => { e.preventDefault(); abrirAba(a.dataset.abaLink); });
document.querySelectorAll("[data-pasta]").forEach(a => a.onclick = e => {
	e.preventDefault();
	abrirAba("mapa");
	const d = [...document.querySelectorAll("summary")].find(s => s.firstChild.textContent.trim() === "📁 " + a.dataset.pasta)?.parentElement;
	if (d) { for (let x = d; x; x = x.parentElement.closest("details")) x.open = true; d.scrollIntoView({ behavior: "smooth" }); }
});
busca.oninput = () => {
	const t = busca.value.toLowerCase();
	document.querySelectorAll("li.p").forEach(li => {
		const titulo = li.firstChild.textContent.toLowerCase().includes(t);
		const texto = (li.dataset.t || "").toLowerCase();
		const i = t.length > 1 && !titulo ? texto.indexOf(t) : -1;
		li.hidden = !titulo && i < 0;
		// achou só no texto: mostra o trecho em volta da palavra
		li.querySelector(".trecho").textContent = i < 0 ? "" : " — …" + li.dataset.t.slice(Math.max(0, i - 60), i + t.length + 60) + "…";
	});
	document.querySelectorAll("details").forEach(d => { d.open = !!t || d.parentElement.parentElement.parentElement.classList.contains("cartao"); d.parentElement.hidden = !d.querySelector("li.p:not([hidden])"); });
};
</script>
</body></html>`;
}

// Página na pasta principal com todos os sites já capturados.
export function montarSites(sites) {
	return `<!DOCTYPE html>
<html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meus sites offline</title><style>${ESTILO}</style></head><body>
<header><div class="topo"><div class="marca">Capturador de Sites</div><h1>Meus sites offline</h1><p class="info">${sites.length} sites</p></div></header>
<main><div class="grade">
${sites.sort((a, b) => a.host.localeCompare(b.host)).map(s => `<a href="${esc(encodeURI(s.host + "/" + INDICE))}"><b>${s.total}</b>${esc(s.host)}</a>`).join("\n")}
</div></main></body></html>`;
}

// ── Recursos compartilhados entre páginas ──────────────────────────────────────────────
// Estilos grandes viram .css e imagens embutidas viram arquivos em _recursos/, com o nome tirado do conteúdo:
// páginas que usam o mesmo estilo/imagem apontam para um arquivo só. Fontes ficam embutidas (dentro do .css):
// o Chrome bloqueia fontes carregadas de arquivo local (file://).
const ESTILO_GRANDE = /<style([^>]*)>([\s\S]{4096,}?)<\/style>/g;
const IMAGEM_EMBUTIDA = /data:image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/=]{2048,}/g;
const EXTENSAO = { png: "png", jpeg: "jpg", jpg: "jpg", gif: "gif", webp: "webp", avif: "avif", bmp: "bmp", "svg+xml": "svg" };

// Conteúdos que valem virar arquivo: { estilos: [css], imagens: [data URI] } (sem repetição).
export function separarRecursos(html) {
	const estilos = [...new Set([...html.matchAll(ESTILO_GRANDE)].map(m => m[2]))];
	const semEstilos = html.replace(ESTILO_GRANDE, "");
	const imagens = [...new Set(semEstilos.match(IMAGEM_EMBUTIDA) || [])];
	return { estilos, imagens };
}
export const extensaoImagem = uri => EXTENSAO[uri.slice(11, uri.indexOf(";"))] || "bin";

// Troca cada conteúdo pelo endereço do arquivo: caminhos = Map(conteúdo → href relativo à página).
export function aplicarRecursos(html, caminhos) {
	return html
		.replace(ESTILO_GRANDE, (todo, attrs, css) => caminhos.has(css) ? `<link rel="stylesheet"${attrs.replace(/\stype=("[^"]*"|\S+)/, "")} href="${caminhos.get(css)}">` : todo)
		.replace(IMAGEM_EMBUTIDA, uri => caminhos.get(uri) || uri);
}

// ── .zip ───────────────────────────────────────────────────────────────────────────────
const TABELA_CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
async function deflate(bytes) {
	return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}
// Arquivo .zip (deflate) a partir de [{ nome, dados: Uint8Array }]. Nomes em UTF-8.
// shortcut: formato zip clássico (até 4 GB e 65 535 arquivos); usar ZIP64 se algum site passar disso.
export async function criarZip(arquivos) {
	const partes = [], central = [];
	let posicao = 0;
	// data/hora de agora no formato do zip (MS-DOS)
	const d = new Date(), dosHora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
	const dosData = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
	for (const { nome, dados } of arquivos) {
		const nomeBytes = new TextEncoder().encode(nome);
		const comprimido = await deflate(dados);
		const crc = crc32(dados);
		const cab = new DataView(new ArrayBuffer(30));
		cab.setUint32(0, 0x04034b50, true); cab.setUint16(4, 20, true); cab.setUint16(6, 0x0800, true); cab.setUint16(8, 8, true);
		cab.setUint16(10, dosHora, true); cab.setUint16(12, dosData, true);
		cab.setUint32(14, crc, true); cab.setUint32(18, comprimido.length, true); cab.setUint32(22, dados.length, true); cab.setUint16(26, nomeBytes.length, true);
		const cen = new DataView(new ArrayBuffer(46));
		cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 8, true);
		cen.setUint16(12, dosHora, true); cen.setUint16(14, dosData, true);
		cen.setUint32(16, crc, true); cen.setUint32(20, comprimido.length, true); cen.setUint32(24, dados.length, true); cen.setUint16(28, nomeBytes.length, true);
		cen.setUint32(42, posicao, true);
		partes.push(new Uint8Array(cab.buffer), nomeBytes, comprimido);
		central.push(new Uint8Array(cen.buffer), nomeBytes);
		posicao += 30 + nomeBytes.length + comprimido.length;
	}
	const tamanhoCentral = central.reduce((t, p) => t + p.length, 0);
	const fim = new DataView(new ArrayBuffer(22));
	fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
	fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, posicao, true);
	return new Uint8Array(await new Blob([...partes, ...central, new Uint8Array(fim.buffer)]).arrayBuffer());
}
