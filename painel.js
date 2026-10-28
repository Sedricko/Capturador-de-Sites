import { normalizar } from "./regras.js";

// Painel: só configura e mostra o progresso. Quem captura é o motor (documento offscreen),
// então fechar ou deixar esta aba em segundo plano não interrompe nada.

const $ = id => document.getElementById(id);
const inicial = new URLSearchParams(location.search).get("start") || "";
$("url").value = inicial;
try { $("prefixo").value = new URL(inicial).origin + "/"; } catch { /* aba sem URL http */ }
let pasta = await lerPasta();
if (pasta) $("pasta").textContent = pasta.name;
let rodando = false;
let abaPdf = +new URLSearchParams(location.search).get("aba") || null;
$("pdf").disabled = !abaPdf;
$("pdf").onclick = () => {
	chrome.runtime.sendMessage({ pdf: abaPdf });
	aviso("📄 Gerando o PDF… (o ícone mostra ✔ quando ele estiver nos Downloads)");
};

// Formulário volta com a última configuração usada.
const { config: ultima } = await chrome.storage.local.get("config");
if (ultima) {
	$("max").value = ultima.max ?? $("max").value;
	$("pausa").value = ultima.pausa ?? $("pausa").value;
	$("profundidade").value = ultima.profundidade ?? 0;
	$("existentes").value = ultima.existentes || "recapturar";
	$("arquivos").checked = !!ultima.arquivos;
	$("excluir").value = (ultima.excluir || []).join("\n");
	for (const campo of ["autoPerfil", "sitemap", "retentar", "continuarSozinho"]) $(campo).checked = ultima[campo] !== false;
}

// Agendamentos: lista com botão de remover; o disparo é do service worker (chrome.alarms).
async function mostrarAgenda() {
	const { agendamentos = [] } = await chrome.storage.local.get("agendamentos");
	$("agenda").replaceChildren(...agendamentos.map(a => {
		const li = document.createElement("li");
		const texto = document.createElement("span");
		texto.textContent = `📅 ${a.nome} — ${a.periodo === "semana" ? "toda semana" : "todo dia"} às ${a.hora}`;
		const remover = document.createElement("button");
		remover.textContent = "Remover";
		remover.onclick = () => chrome.runtime.sendMessage({ desagendar: a.id }).then(mostrarAgenda);
		li.append(texto, remover);
		return li;
	}));
}
mostrarAgenda();
$("continuarSozinho").onchange = async () => {
	const { config = {} } = await chrome.storage.local.get("config");
	chrome.storage.local.set({ config: { ...config, continuarSozinho: $("continuarSozinho").checked } });
};
$("agendar").onclick = async () => {
	const t = novoTrabalho();
	if (!t || !await liberarPasta()) return;
	const nome = t.config.seguir ? new URL(t.fila[0]).hostname : `${t.fila.length} página(s): ${new URL(t.fila[0]).hostname}`;
	const item = { id: "agenda:" + Date.now(), nome, periodo: $("periodo").value, hora: $("hora").value, config: t.config, paginas: t.fila };
	const r = await chrome.runtime.sendMessage({ agendar: item });
	if (r?.erro) return aviso("⚠ " + r.erro);
	aviso(`📅 Agendado: ${nome}, ${item.periodo === "semana" ? "toda semana" : "todo dia"} às ${item.hora}.`);
	mostrarAgenda();
};

const duracao = ms => ms < 60000 ? "menos de 1 min" : ms < 3600000 ? `cerca de ${Math.round(ms / 60000)} min` : `cerca de ${(ms / 3600000).toFixed(1).replace(".", ",")} h`;

// Mostra ao vivo o que o motor grava no storage.
function mostrar({ progresso, trabalho }) {
	if (progresso) {
		rodando = progresso.rodando;
		$("andamento").hidden = !progresso.total;
		$("barra").max = progresso.total || 1;
		$("barra").value = progresso.feitas || 0;
		$("eta").textContent = progresso.total ? `${progresso.feitas || 0} de ${progresso.total} páginas` + (rodando && progresso.eta ? ` · faltam ${duracao(progresso.eta)}` : "") : "";
		$("status").textContent = (progresso.site ? `[${progresso.site}] ` : "") + (progresso.status || "");
		$("log").textContent = (progresso.linhas || []).join("\n");
		$("log").scrollTop = $("log").scrollHeight;
	}
	// Iniciar fica sempre ativo: com outra captura rodando, ele pergunta se deve trocar
	$("parar").disabled = !rodando;
	$("retomar").hidden = rodando || !trabalho;
	if (trabalho) $("retomarTexto").textContent = `Captura interrompida: ${trabalho.n} páginas salvas, ${trabalho.fila.length} na fila (${trabalho.fila[0] || ""}).`;
}
mostrar(await chrome.storage.local.get(["progresso", "trabalho"]));
chrome.storage.onChanged.addListener(async mudancas => {
	if (mudancas.progresso || mudancas.trabalho) mostrar(await chrome.storage.local.get(["progresso", "trabalho"]));
});

// liberar a pasta exige um clique; depois disso a captura não pergunta mais nada
async function liberarPasta() {
	if (!pasta || await pasta.requestPermission({ mode: "readwrite" }) === "granted") return true;
	aviso("Sem permissão para gravar na pasta escolhida.");
	return false;
}
function aviso(msg) {
	$("log").textContent += msg + "\n";
}
async function comando(cmd, trabalho) {
	let r = await chrome.runtime.sendMessage({ cmd, trabalho });
	// uma captura por vez (mesmo de outro site): oferece parar a atual e começar esta
	if (r?.ocupado && confirm(`${r.erro}\n\nParar essa captura e começar esta agora?\n(A atual termina a página em andamento e é encerrada; não dá para continuá-la depois.)`)) {
		aviso("Parando a captura atual… a nova começa logo em seguida.");
		await chrome.runtime.sendMessage({ cmd: "parar" });
		await new Promise(ok => {
			const ver = async () => {
				const { progresso } = await chrome.storage.local.get("progresso");
				if (progresso?.rodando) return;
				chrome.storage.onChanged.removeListener(ver);
				ok();
			};
			chrome.storage.onChanged.addListener(ver);
			ver();
		});
		r = await chrome.runtime.sendMessage({ cmd, trabalho });
	}
	if (r?.erro) return aviso("⚠ " + r.erro);
	// mostra na hora, sem esperar o motor (senão o "Fim" da captura anterior ficaria na tela)
	if (cmd !== "parar") await chrome.storage.local.set({ progresso: { rodando: true, status: "Começando…", linhas: [] } });
}

$("iniciar").onclick = async () => {
	const trabalho = novoTrabalho();
	if (!trabalho || !await liberarPasta()) return;
	comando("iniciar", trabalho);
};
$("continuar").onclick = async () => {
	const { trabalho } = await chrome.storage.local.get("trabalho");
	if (trabalho && await liberarPasta()) comando("continuar", trabalho);
};
$("descartar").onclick = () => chrome.storage.local.remove("trabalho");
$("parar").onclick = () => comando("parar");
$("escolher").onclick = async () => {
	try { pasta = await showDirectoryPicker({ id: "capturas", mode: "readwrite" }); } catch { return; /* cancelou */ }
	await guardarPasta(pasta);
	$("pasta").textContent = pasta.name;
};
chrome.runtime.onMessage.addListener(msg => {
	if (msg.aba) { abaPdf = msg.aba; $("pdf").disabled = false; }
	if (msg.paginaAtual && !rodando && /^https?:/.test(msg.paginaAtual)) {
		$("url").value = msg.paginaAtual;
		$("prefixo").value = new URL(msg.paginaAtual).origin + "/";
	}
});

function novoTrabalho() {
	const seguir = $("seguir").checked;
	// prefixo vazio no modo site inteiro sairia seguindo links da internet toda: usa o site da 1ª página
	if (seguir && !$("prefixo").value.trim()) {
		try { $("prefixo").value = new URL($("url").value.trim().split("\n")[0]).origin + "/"; } catch { /* validado abaixo */ }
	}
	const prefixo = $("prefixo").value.trim();
	const max = +$("max").value, pausa = +$("pausa").value;
	const linhas = $("url").value.split("\n").map(l => l.trim()).filter(Boolean);
	// só a lista: aceita páginas de qualquer site; o prefixo vale para os links seguidos
	const lista = linhas.map(l => normalizar(l, seguir ? prefixo : ""));
	linhas.forEach((l, i) => lista[i] || aviso(`Ignorada (precisa ser http(s)${seguir ? " e começar com o prefixo" : ""}): ${l}`));
	const inicio = [...new Set(lista.filter(Boolean))];
	if (!inicio.length) { aviso("Nenhuma página válida para capturar."); return null; }
	const existentes = $("existentes").value, arquivos = $("arquivos").checked, profundidade = +$("profundidade").value || 0;
	const excluir = $("excluir").value.split("\n").map(l => l.trim().toLowerCase()).filter(Boolean);
	const automacao = { autoPerfil: $("autoPerfil").checked, sitemap: $("sitemap").checked, retentar: $("retentar").checked };
	const config = { seguir, prefixo, max, pausa, existentes, arquivos, profundidade, excluir, ...automacao };
	// guardada para a próxima vez e para as capturas pelo botão direito (e lida pela retomada automática)
	chrome.storage.local.set({ config: { max, pausa, existentes, arquivos, profundidade, excluir, ...automacao, continuarSozinho: $("continuarSozinho").checked } });
	return { config, fila: [...inicio], vistos: [...inicio], capturadas: [], n: 0 };
}

// A pasta escolhida fica guardada no IndexedDB para as próximas capturas (o motor lê daqui também).
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
async function guardarPasta(handle) {
	const db = await banco();
	return new Promise(ok => { const t = db.transaction("config", "readwrite"); t.objectStore("config").put(handle, "pasta"); t.oncomplete = ok; t.onerror = ok; });
}
