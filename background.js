import { prepararPagina, coletarLinks, capturar } from "./pagina.js";
import { DOMINIOS_ANUNCIO, CONFIG_PADRAO, normalizar, proximoHorario } from "./regras.js";

const PAGINA = { prepararPagina, coletarLinks, capturar };

// Se o painel já estiver aberto (por exemplo, no meio de uma captura), só traz ele para a frente.
chrome.action.onClicked.addListener(async tab => {
	const abertos = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
	const painel = abertos.find(c => c.documentUrl.startsWith(chrome.runtime.getURL("painel.html")));
	if (!painel) return chrome.tabs.create({ url: `painel.html?aba=${tab.id}&start=` + encodeURIComponent(tab.url || "") });
	await chrome.tabs.update(painel.tabId, { active: true });
	await chrome.windows.update(painel.windowId, { focused: true });
	chrome.runtime.sendMessage({ paginaAtual: tab.url, aba: tab.id }).catch(() => {});
});

// Botão direito na página e no ícone da extensão: capturar ou gerar PDF sem abrir o painel.
chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({ id: "pagina", title: "Capturar só esta página", contexts: ["page", "action"] });
	chrome.contextMenus.create({ id: "site", title: "Capturar este site inteiro", contexts: ["page", "action"] });
	chrome.contextMenus.create({ id: "pdf", title: "Salvar esta página em PDF", contexts: ["page", "action"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId === "pdf") salvarPdf(tab.id);
	if (info.menuItemId === "pagina" || info.menuItemId === "site") capturarPeloMenu(tab.url, info.menuItemId === "site");
});

const notificar = (title, message) => chrome.notifications.create({ type: "basic", iconUrl: "icone.png", title, message });

// Usa a última configuração do painel (pasta, velocidade, exclusões…); só o modo e o site vêm do clique.
async function capturarPeloMenu(url, seguir) {
	const { config, progresso } = await chrome.storage.local.get(["config", "progresso"]);
	if (progresso?.rodando) return notificar("Capturador: já tem uma captura rodando", "Clique no ícone para ver o progresso.");
	const prefixo = /^https?:/.test(url) ? new URL(url).origin + "/" : "";
	const inicio = normalizar(url, seguir ? prefixo : "");
	if (!inicio) return notificar("Capturador: esta página não pode ser capturada", url);
	const trabalho = { config: { ...CONFIG_PADRAO, ...config, seguir, prefixo }, fila: [inicio], vistos: [inicio], capturadas: [], n: 0 };
	if (await iniciarTrabalho("iniciar", trabalho)) notificar("Capturador: captura iniciada", seguir ? `Site inteiro: ${prefixo}` : url);
}

// Entrega um trabalho ao motor; devolve false (e avisa) se ele estiver ocupado com outra captura.
async function iniciarTrabalho(comando, trabalho) {
	await garantirMotor();
	const r = await chrome.runtime.sendMessage({ motor: comando, trabalho });
	if (r?.erro) {
		notificar("Capturador: não começou", r.erro);
		return false;
	}
	return true;
}

// Agendamentos ("todo dia"/"toda semana" às HH:MM) e retomada automática usam chrome.alarms,
// que dispara mesmo com o painel fechado e sobrevive ao service worker ser encerrado.
async function agendar(item) {
	const { agendamentos = [] } = await chrome.storage.local.get("agendamentos");
	await chrome.storage.local.set({ agendamentos: [...agendamentos.filter(a => a.id !== item.id), item] });
	await chrome.alarms.create(item.id, { when: proximoHorario(item.periodo, item.hora), periodInMinutes: item.periodo === "semana" ? 10080 : 1440 });
}
async function desagendar(id) {
	const { agendamentos = [] } = await chrome.storage.local.get("agendamentos");
	await chrome.storage.local.set({ agendamentos: agendamentos.filter(a => a.id !== id) });
	await chrome.alarms.clear(id);
}
chrome.alarms.onAlarm.addListener(async alarme => {
	if (alarme.name === "retomar") {
		const { trabalho } = await chrome.storage.local.get("trabalho");
		if (trabalho && await iniciarTrabalho("continuar", trabalho)) notificar("Capturador: continuando sozinho ↻", "A captura interrompida foi retomada de onde parou.");
		return;
	}
	const id = alarme.name.replace(/:adiado$/, "");
	const { agendamentos = [] } = await chrome.storage.local.get("agendamentos");
	const item = agendamentos.find(a => a.id === id);
	if (!item) return;
	const trabalho = { config: item.config, fila: [...item.paginas], vistos: [...item.paginas], capturadas: [], n: 0 };
	// ocupado com outra captura: tenta de novo em 30 min
	if (await iniciarTrabalho("iniciar", trabalho)) notificar("Capturador: captura agendada começou 📅", item.nome);
	else chrome.alarms.create(id + ":adiado", { delayInMinutes: 30 });
});

// Funções de pagina.js rodadas daqui (o PDF não passa pelo motor): esperam a resposta { resultado: id }.
const resultados = new Map();
function naAba(tabId, nome, args, limiteMs) {
	const id = `sw-${Date.now()}`;
	return new Promise((ok, falha) => {
		const limite = setTimeout(() => { resultados.delete(id); falha(new Error("a página não respondeu")); }, limiteMs);
		resultados.set(id, m => {
			clearTimeout(limite);
			resultados.delete(id);
			if (m.erro) falha(new Error(m.erro)); else ok(m.valor);
		});
		chrome.scripting.executeScript({ target: { tabId }, func: PAGINA[nome], args: [...args, id] }).catch(e => { clearTimeout(limite); falha(e); });
	});
}

// PDF pelo gerador interno do Chrome (Page.printToPDF): sem janela de impressão; vai para os Downloads.
async function salvarPdf(tabId) {
	await chrome.action.setBadgeText({ text: "PDF" });
	try {
		await naAba(tabId, "prepararPagina", [], 60000); // destrava as imagens "lazy" antes
		const { title, url } = await chrome.tabs.get(tabId);
		const alvo = { tabId };
		await chrome.debugger.attach(alvo, "1.3");
		let pdf;
		try {
			pdf = await chrome.debugger.sendCommand(alvo, "Page.printToPDF", { printBackground: true });
		} finally {
			await chrome.debugger.detach(alvo).catch(() => {});
		}
		// o service worker não cria blob URL; o motor (offscreen) cria e pede o download
		await garantirMotor();
		// o download recusa alguns caracteres (acentos inclusive, em certos sistemas): tira acento e troca o resto por _
		const nome = (title || new URL(url).hostname).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
			.replace(/[^\x20-\x7e]|[\\/:*?"<>|]/g, "_").trim().slice(0, 120) || "pagina";
		const r = await chrome.runtime.sendMessage({ motor: "baixarPdf", base64: pdf.data, nome: nome + ".pdf" });
		if (r?.erro) throw new Error(r.erro);
		await chrome.action.setBadgeText({ text: "✔" });
		await chrome.action.setTitle({ title: "PDF salvo nos Downloads: " + nome + ".pdf" });
		notificar("Capturador: PDF pronto 📄", nome + ".pdf está nos Downloads.");
	} catch (e) {
		await chrome.action.setBadgeText({ text: "✖" });
		await chrome.action.setTitle({ title: "Não deu para gerar o PDF: " + e.message });
		notificar("Capturador: não deu para gerar o PDF", e.message);
	}
}

// Ao abrir o Chrome com uma captura interrompida, o ícone avisa (⏸); o painel mostra o botão "Continuar".
chrome.runtime.onStartup.addListener(async () => {
	const { trabalho, progresso } = await chrome.storage.local.get(["trabalho", "progresso"]);
	if (progresso) await chrome.storage.local.set({ progresso: { ...progresso, rodando: false } });
	if (!trabalho) return;
	chrome.action.setBadgeText({ text: "⏸" });
	// continuar sozinho: espera 1 min para o Chrome terminar de abrir
	const { config } = await chrome.storage.local.get("config");
	if (config?.continuarSozinho !== false) chrome.alarms.create("retomar", { delayInMinutes: 1 });
});

// O motor da captura roda num documento offscreen: não é uma aba, então o Chrome não o congela
// quando o painel fica em segundo plano ou é fechado.
async function garantirMotor() {
	const [motor] = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
	if (!motor) await chrome.offscreen.createDocument({ url: "motor.html", reasons: ["DOM_PARSER", "BLOBS"], justification: "Capturar e salvar páginas em segundo plano" });
}

// Pedidos que só o service worker pode atender (o motor offscreen só tem chrome.runtime).
// Nenhum demora mais que alguns segundos: o Chrome encerra o service worker parado por 30 s.
const RPC = {
	esperar: ms => new Promise(r => setTimeout(r, Math.min(ms, 20000))),
	get: chaves => chrome.storage.local.get(chaves),
	set: itens => chrome.storage.local.set(itens),
	remove: chaves => chrome.storage.local.remove(chaves),
	badge: text => chrome.action.setBadgeText({ text }),
	notificar: (titulo, texto) => notificar(titulo, texto),
	// Ganchos e script de iframes do SingleFile: entram desde o começo do carregamento de cada página.
	// Ficam ligados só durante a captura (o SingleFile original os mantém sempre, em todos os sites).
	async ganchos(ligar) {
		const ids = ["sf-frames", "sf-hooks"];
		const registrados = await chrome.scripting.getRegisteredContentScripts({ ids });
		if (registrados.length) await chrome.scripting.unregisterContentScripts({ ids: registrados.map(r => r.id) });
		if (!ligar) return true;
		const comum = { matches: ["<all_urls>"], allFrames: true, matchOriginAsFallback: true, runAt: "document_start", persistAcrossSessions: false };
		await chrome.scripting.registerContentScripts([
			{ id: "sf-frames", js: ["vendor/single-file-frames.bundle.js"], ...comum },
			{ id: "sf-hooks", js: ["vendor/single-file-hooks-frames.js"], world: "MAIN", ...comum }
		]);
		return true;
	},
	async janela() {
		const janela = await chrome.windows.create({ url: "about:blank", state: "minimized" });
		const abaId = janela.tabs[0].id;
		await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [abaId], addRules: [{
			id: abaId, action: { type: "block" }, condition: { tabIds: [abaId], requestDomains: DOMINIOS_ANUNCIO }
		}] });
		return { janelaId: janela.id, abaId };
	},
	async fecharJanela(janelaId, abaId) {
		await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [abaId] }).catch(() => {});
		await chrome.windows.remove(janelaId).catch(() => {});
	},
	navegar: (abaId, url) => chrome.tabs.update(abaId, { url }).then(() => true),
	estadoAba: abaId => chrome.tabs.get(abaId).then(t => ({ status: t.status, url: t.url })),
	singlefile: abaId => chrome.scripting.executeScript({ target: { tabId: abaId }, files: ["vendor/single-file.js"] }).then(() => true),
	// a função na página responde depois com { resultado: id }
	pagina: (abaId, nome, args) => chrome.scripting.executeScript({ target: { tabId: abaId }, func: PAGINA[nome], args }).then(() => true),
	baixar: (url, filename, conflictAction = "overwrite") => chrome.downloads.download({ url, filename, conflictAction, saveAs: false })
};

// Serviços que o SingleFile pede à extensão (equivalentes aos do background dele):
// relógio que não é estrangulado em aba escondida, e repasse de mensagens entre os iframes e a página.
const relogios = new Map();
function servicoSingleFile(msg, remetente, responder) {
	const aba = remetente.tab?.id;
	const chave = `${aba}:${remetente.frameId}:${msg.type}`;
	if (msg.method === "singlefile.lazyTimeout.setTimeout") {
		clearTimeout(relogios.get(chave));
		relogios.set(chave, setTimeout(() => {
			relogios.delete(chave);
			chrome.tabs.sendMessage(aba, { method: "singlefile.lazyTimeout.onTimeout", type: msg.type }, { frameId: remetente.frameId }).catch(() => {});
		}, msg.delay));
		responder({});
	} else if (msg.method === "singlefile.lazyTimeout.clearTimeout") {
		clearTimeout(relogios.get(chave));
		relogios.delete(chave);
		responder({});
	} else if (msg.method === "singlefile.frameTree.initResponse" || msg.method === "singlefile.frameTree.ackInitRequest") {
		chrome.tabs.sendMessage(aba, msg, { frameId: 0 }).catch(() => {});
		responder({});
	} else if (msg.method === "singlefile.frameTree.getOptions") {
		chrome.tabs.sendMessage(aba, msg, { frameId: 0 }).then(responder, () => responder({}));
		return true;
	} else if (msg.method === "singlefile.fetchFrame") {
		chrome.tabs.sendMessage(aba, msg).then(responder, e => responder({ error: e.message }));
		return true;
	}
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
	if (msg.method?.startsWith("singlefile.")) return servicoSingleFile(msg, _remetente, responder);
	if (msg.esperar !== undefined) {
		RPC.esperar(msg.esperar).then(() => responder(true));
		return true;
	}
	if (msg.resultado) resultados.get(msg.resultado)?.(msg);
	if (msg.agendar) {
		agendar(msg.agendar).then(() => responder("ok"), e => responder({ erro: e.message }));
		return true;
	}
	if (msg.desagendar) {
		desagendar(msg.desagendar).then(() => responder("ok"));
		return true;
	}
	if (msg.pdf) {
		salvarPdf(msg.pdf);
		return;
	}
	if (msg.rpc) {
		RPC[msg.rpc](...(msg.args || [])).then(valor => responder({ valor }), e => responder({ erro: e.message }));
		return true;
	}
	if (msg.cmd) {
		// comando do painel (iniciar, parar, continuar) repassado ao motor
		garantirMotor().then(() => chrome.runtime.sendMessage({ motor: msg.cmd, trabalho: msg.trabalho })).then(responder, e => responder({ erro: e.message }));
		return true;
	}
});
