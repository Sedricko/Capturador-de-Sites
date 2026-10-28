// Monta o "livro" de um site a partir das páginas já salvas na pasta: capa, sumário com links e cada página
// num shadow DOM (o estilo de uma não vaza para as outras). O motor imprime esta página em PDF depois.
// Avisa quando terminar com { livroPronto }.

const params = new URLSearchParams(location.search);
const host = params.get("host"), limite = +params.get("limite") || 300;
const $ = id => document.getElementById(id);

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
async function abrirArquivo(pasta, caminho) {
	const partes = caminho.split("/").filter(Boolean);
	let dir = pasta;
	for (const nome of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(nome);
	return (await dir.getFileHandle(partes.at(-1))).getFile();
}

// endereços relativos (../_recursos/x.css, _miniaturas…) viram blob: lidos da pasta
const blobs = new Map();
async function resolver(pasta, deArquivo, href) {
	if (!href || /^(data:|blob:|https?:|#|mailto:|javascript:)/i.test(href)) return href;
	const base = deArquivo.split("/").slice(0, -1);
	for (const parte of href.split(/[?#]/)[0].split("/")) {
		if (parte === "..") base.pop(); else if (parte && parte !== ".") base.push(decodeURIComponent(parte));
	}
	const caminho = base.join("/");
	if (!blobs.has(caminho)) blobs.set(caminho, abrirArquivo(pasta, caminho).then(f => URL.createObjectURL(f)).catch(() => href));
	return blobs.get(caminho);
}

async function montar() {
	const pasta = await lerPasta();
	const chave = "paginas:" + host;
	const salvas = (await chrome.storage.local.get(chave))[chave] || {};
	const paginas = Object.values(salvas).sort((a, b) => a.arquivo.localeCompare(b.arquivo)).slice(0, limite);
	$("nome").textContent = host;
	$("info").textContent = `${paginas.length} páginas · ${new Date().toLocaleString("pt-BR")}`;
	document.title = `Livro — ${host}`;
	for (const [i, p] of paginas.entries()) {
		const titulo = (p.titulo || p.arquivo).split(" | ")[0];
		const item = document.createElement("li");
		item.innerHTML = `<a href="#p${i}"></a>`;
		item.firstChild.textContent = titulo;
		$("sumario").append(item);
		const secao = document.createElement("section");
		secao.className = "pagina";
		secao.id = `p${i}`;
		const h2 = document.createElement("h2");
		h2.textContent = titulo; // vira marcador do PDF (generateDocumentOutline)
		const corpo = document.createElement("div");
		secao.append(h2, corpo);
		$("paginas").append(secao);
		try {
			// caminho relativo à pasta escolhida (que faz o papel de "capturas")
			const arquivo = p.arquivo.split("/").slice(1).join("/");
			const doc = new DOMParser().parseFromString(await (await abrirArquivo(pasta, arquivo)).text(), "text/html");
			doc.querySelector("a[href$='00-INICIO.html']")?.remove(); // botão "☰ Índice do site"
			for (const el of doc.querySelectorAll("link[rel~=stylesheet][href]")) el.href = await resolver(pasta, arquivo, el.getAttribute("href"));
			for (const el of doc.querySelectorAll("img[src]")) el.src = await resolver(pasta, arquivo, el.getAttribute("src"));
			const sombra = corpo.attachShadow({ mode: "open" });
			sombra.innerHTML = [...doc.querySelectorAll("style, link[rel~=stylesheet]")].map(e => e.outerHTML).join("") + `<div>${doc.body.innerHTML}</div>`;
			await Promise.race([
				Promise.all([...sombra.querySelectorAll("img, link[rel~=stylesheet]")].map(e => (e.complete || e.sheet) ? null : new Promise(r => { e.onload = e.onerror = r; }))),
				new Promise(r => setTimeout(r, 15000))
			]);
			// barras fixas (topo, menu lateral) se repetiriam em todas as folhas do PDF
			for (const el of sombra.querySelectorAll("*")) if (/fixed|sticky/.test(getComputedStyle(el).position)) el.style.display = "none";
		} catch (e) {
			corpo.textContent = "(não deu para ler esta página: " + e.message + ")";
		}
	}
	chrome.runtime.sendMessage({ livroPronto: host, paginas: paginas.length });
}
montar().catch(e => chrome.runtime.sendMessage({ livroPronto: host, erro: e.message }));
