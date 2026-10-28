import assert from "node:assert";
import { normalizar, nomeArquivo, caminhoRelativo } from "./regras.js";
const p = "https://site.com/";
assert.equal(normalizar("https://site.com/a#topo", p), "https://site.com/a");
assert.equal(normalizar("https://outro.com/a", p), null);
assert.equal(normalizar("https://site.com/f.PDF", p), null);
assert.equal(normalizar("mailto:x@site.com", p), null);
assert.equal(normalizar("lixo", p), null);
assert.equal(normalizar("https://site.com/blog/2?p=3", "https://site.com/blog/"), "https://site.com/blog/2?p=3");
assert.equal(nomeArquivo("https://site.com/"), "capturas/site.com/index.html");
assert.equal(nomeArquivo("https://site.com/blog/"), "capturas/site.com/blog/index.html");
assert.equal(nomeArquivo("https://site.com/blog/post-1"), "capturas/site.com/blog/post-1.html");
assert.equal(nomeArquivo("https://site.com/blog/2.html"), "capturas/site.com/blog/2.html");
assert.equal(nomeArquivo("https://site.com/produtos/caf%C3%A9 bom/?p=2"), "capturas/site.com/produtos/café_bom/index_p_2.html");
assert.equal(nomeArquivo("https://site.com/../.oculto/x"), "capturas/site.com/oculto/x.html");
assert.equal(caminhoRelativo("c/s/index.html", "c/s/blog/x.html"), "blog/x.html");
assert.equal(caminhoRelativo("c/s/blog/x.html", "c/s/index.html"), "../index.html");
assert.equal(caminhoRelativo("c/s/blog/x.html", "c/s/blog/y.html"), "y.html");
assert.equal(caminhoRelativo("c/s/a/b/x.html", "c/s/c/y.html"), "../../c/y.html");
const w = "https://x.fandom.com/";
assert.equal(normalizar("https://x.fandom.com/wiki/Espada_de_Fogo", w), "https://x.fandom.com/wiki/Espada_de_Fogo");
assert.equal(normalizar("https://x.fandom.com/wiki/Category:Itens", w), "https://x.fandom.com/wiki/Category:Itens");
assert.equal(normalizar("https://x.fandom.com/wiki/Special:AllPages", w), "https://x.fandom.com/wiki/Special:AllPages");
assert.equal(normalizar("https://x.fandom.com/wiki/Special:Community", w), null);
assert.equal(normalizar("https://x.fandom.com/wiki/User_talk:Joao", w), null);
assert.equal(normalizar("https://x.fandom.com/wiki/Template:Caixa", w), null);
assert.equal(normalizar("https://x.fandom.com/wiki/Home?action=edit", w), null);
assert.equal(normalizar("https://x.fandom.com/f", w), null);
assert.equal(normalizar("https://x.fandom.com/f/p/123", w), null);
assert.equal(normalizar("https://x.fandom.com/fotos", w), "https://x.fandom.com/fotos");
console.log("ok");
import { montarIndice, montarSites } from "./regras.js";
assert.equal(normalizar("https://x.fandom.com/signin?redirect=1", w), null);
assert.equal(normalizar("https://site.com/login/", p), null);
const ind = montarIndice("site.com", [
	{ url: "https://site.com/", arquivo: "capturas/site.com/index.html", titulo: "Início | Site" },
	{ url: "https://site.com/blog/a", arquivo: "capturas/site.com/blog/a.html", titulo: "Post <A> | Site | Fandom" },
	{ url: "https://site.com/blog/café", arquivo: "capturas/site.com/blog/café.html", titulo: "Café" },
	{ url: "https://site.com/blog/Category:Itens", arquivo: "capturas/site.com/blog/Category_Itens.html", titulo: "Category:Itens | Site" },
	{ url: "https://site.com/blog/z", arquivo: "capturas/site.com/blog/z.html", titulo: "https://site.com/blog/z", online: true },
], "capturas/site.com/index.html");
assert.ok(ind.includes('<a href="index.html">Início</a>'), "título limpo");
assert.ok(ind.includes('<a class="abrir" href="index.html">'), "botão abrir o site");
assert.ok(ind.includes('<a href="blog/a.html">Post &lt;A&gt;</a>'));
assert.ok(ind.includes('href="blog/caf%C3%A9.html"'));
assert.ok(ind.includes('📁 Category <small>(1)</small></summary><ul><li class="p"><a href="blog/Category_Itens.html">Itens</a>'), "categoria em pasta própria");
assert.ok(ind.includes('<li class="p online"><a href="https://site.com/blog/z">/blog/z</a>'));
assert.ok(ind.indexOf(">Café<") < ind.indexOf(">Post &lt;A&gt;<"), "ordenado por título");
assert.ok(ind.includes("📁 blog <small>(4)</small>") && ind.includes("4 páginas salvas"));
assert.ok(montarSites([{ host: "b.com", total: 2 }, { host: "a.com", total: 5 }]).indexOf("a.com/00-INICIO.html") < montarSites([{ host: "b.com", total: 2 }, { host: "a.com", total: 5 }]).indexOf("b.com/"));
console.log("ok índice");
import { arquivoLocal, paginaNaoCapturada, MARCA_NAO_CAPTURADA, ARQUIVOS } from "./regras.js";
assert.equal(normalizar("https://site.com/wiki/Category:X", p, ["category:"]), null, "excluído");
assert.equal(normalizar("https://site.com/wiki/Item", p, ["category:"]), "https://site.com/wiki/Item");
assert.equal(arquivoLocal("https://cdn.com/docs/Manual%20v2.pdf", "site.com"), "capturas/site.com/_arquivos/cdn.com/docs/Manual_v2.pdf");
assert.ok(ARQUIVOS.test("/a/b.PDF") && !ARQUIVOS.test("/a/b.html"));
assert.ok(paginaNaoCapturada('https://site.com/x?a="1"').includes(MARCA_NAO_CAPTURADA) && paginaNaoCapturada('https://site.com/x?a="1"').includes("&quot;1&quot;"));
const comTexto = montarIndice("site.com", [{ url: "https://site.com/a", arquivo: "capturas/site.com/a.html", titulo: "A", texto: 'fala do Blade "Dancer"' }]);
assert.ok(comTexto.includes('data-t="fala do Blade &quot;Dancer&quot;"'), "texto para busca");
console.log("ok 4.1");
import { reconhecerSite, lerSitemap, proximoHorario } from "./regras.js";
assert.equal(normalizar("https://site.com/a?utm_source=x&id=2&fbclid=y", p), "https://site.com/a?id=2", "sem rastreio");
assert.equal(normalizar("https://site.com/a?utm_source=x", p), "https://site.com/a");
assert.equal(reconhecerSite({ gerador: "WordPress 6.5", host: "blog.com", marcas: "" }).nome, "WordPress");
assert.equal(reconhecerSite({ gerador: "", host: "heroic.fandom.com", marcas: "" }).nome, "Wiki (MediaWiki/Fandom)");
assert.equal(reconhecerSite({ gerador: "", host: "x.com", marcas: "" }), null);
const sm = lerSitemap(`<urlset><url><loc>https://s.com/a?x=1&amp;y=2</loc></url><url>\n<loc> https://s.com/b </loc></url></urlset><sitemapindex><sitemap><loc>https://s.com/s2.xml</loc></sitemap></sitemapindex>`);
assert.deepEqual(sm, { paginas: ["https://s.com/a?x=1&y=2", "https://s.com/b"], sitemaps: ["https://s.com/s2.xml"] });
const agora = new Date(2026, 9, 28, 10, 0);
assert.equal(new Date(proximoHorario("dia", "03:00", agora)).getDate(), 29, "amanhã às 3h");
assert.equal(new Date(proximoHorario("dia", "23:30", agora)).getDate(), 28, "hoje mais tarde");
assert.equal(new Date(proximoHorario("semana", "09:00", agora)).getDate(), 4, "daqui a 7 dias");
console.log("ok 5.1");
import { separarRecursos, aplicarRecursos, extensaoImagem, criarZip } from "./regras.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
{
	const css = "a{}" + "x".repeat(5000), img = "data:image/png;base64," + "A".repeat(3000), pequena = "data:image/gif;base64,R0lGOD";
	const html = `<style media="print">${css}</style><style>b{}</style><img src="${img}"><i style="background:url(${img})"></i><img src="${pequena}">`;
	const r = separarRecursos(html);
	assert.deepEqual(r, { estilos: [css], imagens: [img] }, "só o que é grande, sem repetição");
	assert.equal(extensaoImagem(img), "png");
	const novo = aplicarRecursos(html, new Map([[css, "../_recursos/a.css"], [img, "../_recursos/b.png"]]));
	assert.equal(novo, `<link rel="stylesheet" media="print" href="../_recursos/a.css"><style>b{}</style><img src="../_recursos/b.png"><i style="background:url(../_recursos/b.png)"></i><img src="${pequena}">`);
	// o zip abre no unzip de verdade, com acentos no nome
	const zip = await criarZip([{ nome: "site/página.html", dados: new TextEncoder().encode("olá ".repeat(1000)) }, { nome: "site/_recursos/x.bin", dados: new Uint8Array([0, 1, 2, 255]) }]);
	const pasta = mkdtempSync(tmpdir() + "/zip-"); writeFileSync(pasta + "/t.zip", zip);
	const lista = execFileSync("unzip", ["-l", pasta + "/t.zip"]).toString();
	assert.ok(lista.includes("site/página.html") && lista.includes("5000"), lista);
	assert.equal(execFileSync("unzip", ["-p", pasta + "/t.zip", "site/página.html"]).toString(), "olá ".repeat(1000));
	execFileSync("unzip", ["-tq", pasta + "/t.zip"]);
}
console.log("ok 6.0 recursos e zip");
{
	const ind = montarIndice("s.com", [{ url: "https://s.com/a", arquivo: "capturas/s.com/a.html", titulo: "A", miniatura: "_miniaturas/a.jpg", versoes: [{ data: "27/10/2026 10:00", arquivo: "_versoes/a/2026-10-27_10-00.html" }] }], "capturas/s.com/a.html");
	assert.ok(ind.includes('<img class="mini" src="_miniaturas/a.jpg"'), "miniatura no cartão");
	assert.ok(ind.includes('🕰️ <a href="_versoes/a/2026-10-27_10-00.html">27/10/2026 10:00</a>'), "link da versão antiga");
}
console.log("ok 6.0 índice");
