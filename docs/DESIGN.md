# Design e fronteiras da interface

Conceito visual gerado com Image Gen: `design-concept.png`. Brief: dashboard completo em pt-BR, Resumo/Recorrências/Cartões/Histórico/Ajustes, sidebar branca, saldo verde profundo, gráficos e tabela, com cores oficiais do RPD. Referência visual; valores fictícios não representam regras ou resultados reais.

- Cor: #008847; fundo #F6FAF8; superfície #fff; texto #17201B; borda #DDE7E1.
- Manrope hospedada no próprio app, pesos 400–800. Números tabulares.
- Sidebar de 248 px; conteúdo com intervalos de 20–24 px; cartões com raio de 14 px.
- Navegação e ações: ícones Lucide, traço 1.8–2, botões de 44 px ou mais.
- Mobile: 360–430 px, formulários em coluna e os cinco destinos na barra inferior.
- Domínio financeiro, validação, permissões e banco são independentes de CSS/React.
- Lovable pode editar `src/components`, `src/pages`, `src/styles.css`; alterações em `src/domain` e `src/data` precisam de revisão de engenharia e testes.
- Dados dinâmicos, estados vazios, busca, avisos de modo local e controles pedidos no RPD estendem a referência no mesmo sistema visual.

Sem imagens decorativas no produto: marca e gráficos são vetores nativos, texto e controles são HTML acessível.
