# GDASH Analytics

Aplicação Full Stack de monitoramento climático com dashboard, histórico e ingestão de dados por fila.

[Aplicação publicada](https://gdash-project-challenge.vercel.app/) · [Guia técnico](docs/TECHNICAL_GUIDE.md) · [CI](https://github.com/alvaro-amorim/gdash-project-challenge/actions/workflows/worker-tests.yml)

## Visão geral

O GDASH coleta dados meteorológicos, mantém histórico e apresenta consultas por cidade. O projeto combina uma aplicação web com um pipeline local de ingestão e uma rotina independente de sincronização agendada.

**Estado:** MVP de portfólio com versão publicada. A disponibilidade do frontend não comprova que todos os componentes do pipeline estejam implantados.

## Funcionalidades

- Autenticação por código de e-mail e Google opcional.
- Perfil com localização preferida e busca de cidades.
- Clima atual, histórico horário e exportação CSV/XLSX.
- Administração de usuários e indicadores de visita.
- Insights com provider opcional de IA e fallback local.
- Ingestão por RabbitMQ e sincronização meteorológica agendada.

## Arquitetura

~~~mermaid
flowchart LR
  C[Coletor Python] --> Q[RabbitMQ]
  Q --> W[Worker Go]
  W --> A[API NestJS]
  A --> M[MongoDB]
  F[Frontend React] --> A
  S[Sincronização agendada] --> A
~~~

## Decisões técnicas

| Decisão | Objetivo |
|---|---|
| Coleta e consumo separados por fila | Desacoplar a origem dos dados da persistência na API. |
| Confirmação manual após HTTP 200/201 | Preservar a mensagem quando a API falha. |
| Uma entrega em processamento por consumidor | Limitar mensagens não confirmadas. |
| Upsert por coordenadas e horário | Reutilizar a mesma medição em reentregas sequenciais. |

**Stack:** React, TypeScript, NestJS, MongoDB, RabbitMQ, Python, Go e Docker Compose.

## Executar localmente

Configure um `.env` a partir de [.env.example](.env.example), usando serviços e dados de desenvolvimento. Depois:

~~~bash
docker compose up -d --build
~~~

- Frontend: `http://localhost:5173`.
- API: `http://localhost:3000`.
- RabbitMQ Management: `http://localhost:15672`.

O [guia técnico](docs/TECHNICAL_GUIDE.md) descreve autenticação, variáveis, endpoints e implantação.

## Verificação

No diretório `backend-nestjs`:

~~~bash
npm ci
npm test -- --runInBand
npm run build
~~~

No diretório `worker-go`:

~~~bash
go test -v ./...
go vet ./...
go build ./...
~~~

O workflow **Worker delivery checks** executa testes e build do backend, além de formatação, análise estática e testes do worker com RabbitMQ descartável e detector de concorrência. A [execução da correção de ingestão](https://github.com/alvaro-amorim/gdash-project-challenge/actions/runs/40579098921) foi aprovada.

## Confiabilidade e limites

A entrega é pelo menos uma vez: um POST pode se repetir se a confirmação for perdida após a persistência. Falhas retornam à fila após cinco segundos; redirecionamentos não contam como sucesso.

Ainda não há fila de falhas ou limite de tentativas. O índice de medições não é único; a validação de reentrega sequencial não comprova deduplicação sob consumidores concorrentes. A nova lógica depende da implantação do worker atualizado no ambiente Docker.

[Detalhes de reentrega, testes e operação](docs/TECHNICAL_GUIDE.md).
