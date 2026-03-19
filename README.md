🌦️ GDASH Challenge - Intelligent Weather Monitor

Uma plataforma Full-Stack de monitoramento climático em tempo real, baseada em arquitetura de microsserviços orientada a eventos e alimentada por Inteligência Artificial Generativa.

🧠 Configuração da Inteligência Artificial (IMPORTANTE)

O sistema utiliza o Google Gemini 1.5 Flash para gerar insights climáticos avançados.
Sem a chave de API, o projeto funciona em modo de contingência (Fallback), com regras locais simplificadas.

🔑 Como gerar sua chave

Acesse o Google AI Studio:
https://aistudio.google.com/app/apikey

Clique em Create API key.

Copie a chave gerada (começa com AIza...).

📥 Onde inserir a chave

Abra o arquivo docker-compose.yml na raiz do projeto e cole a sua chave na variável GEMINI_API_KEY:

collector:
  environment:
    GEMINI_API_KEY: "SUA_CHAVE_AQUI"


Alternativa: você pode exportar a variável no terminal antes de subir os containers:

export GEMINI_API_KEY="AIza...SUA_CHAVE..."
docker-compose up -d --build


📋 Sobre o Projeto

Esta solução foi desenvolvida como parte do processo seletivo da GDASH. O objetivo foi criar um sistema resiliente e escalável que não apenas coleta dados meteorológicos, mas gera inteligência contextual sobre eles.

O sistema coleta dados da Open-Meteo, processa-os através de uma pipeline de mensageria robusta e apresenta-os num Dashboard interativo que se adapta visualmente ao ciclo dia/noite.

🚀 Diferenciais Implementados

IA Generativa Real: Integração com Google Gemini 1.5 Flash para gerar insights climáticos únicos e humanizados.

Resiliência (Fallback): Sistema de contingência que ativa uma lógica local robusta caso a API de IA falhe ou fique offline.

UX Profissional: Interface moderna que alterna temas automaticamente (Dia/Noite) e gráficos fluídos sem "flicker" de carregamento.

Auditoria: Ferramentas completas de filtragem histórica e exportação de relatórios oficiais (Excel/CSV).

⚙️ Arquitetura da Solução

O sistema segue uma arquitetura desacoplada onde cada serviço possui responsabilidade única:

Collector (Python 3.11):

Ingestão de dados da Open-Meteo.

Conexão com Google Gemini para enriquecimento de dados (Insights).

Produtor de mensagens para o RabbitMQ.

Message Broker (RabbitMQ):

Garante o desacoplamento e a persistência dos dados entre coleta e processamento.

Worker (Go 1.24):

Consumidor de alta performance.

Processa a fila e despacha os dados validados para a API via HTTP.

API (NestJS / Node 20):

Gestão de regras de negócio, autenticação JWT e persistência no MongoDB.

Geração de relatórios (Excel/CSV).

Documentação automática via Swagger.

Frontend (React + Vite):

Dashboard em tempo real (Polling inteligente).

Gráficos interativos com Recharts e estilização com Tailwind CSS.

🛠️ Tecnologias Utilizadas

Camada

Tecnologia

Detalhes

Infraestrutura

Docker & Compose

Orquestração completa dos 6 serviços

Coleta & IA

Python 3.11

Requests, Pika, Google GenAI SDK

Mensageria

RabbitMQ

Gestão de filas e exchanges

Worker

Go (Golang) 1.24

Processamento concorrente de alta velocidade

Backend

NestJS (Node 20)

TypeScript, Mongoose, Swagger, ExcelJS

Banco de Dados

MongoDB

Armazenamento de logs históricos

Frontend

React (Vite)

TypeScript, TailwindCSS, Recharts

🚀 Como Rodar o Projeto

Pré-requisitos

Docker e Docker Compose instalados e rodando.

Passo a Passo

Clone o repositório

git clone [https://github.com/alvaro-amorim/desafio-gdash-2025-02.git](https://github.com/alvaro-amorim/desafio-gdash-2025-02.git)
cd gdash-challenge


Gere sua chave de API no Google

Acesse:
https://aistudio.google.com/app/apikey

Clique em Create API Key e copie a chave que começa com AIza....

Adicione sua chave ao docker-compose.yml

Ajuste a variável GEMINI_API_KEY dentro do serviço collector:

# Exemplo de uso no docker-compose.yml
collector:
  environment:
    GEMINI_API_KEY: "SUA_CHAVE_AQUI"


Ou exporte no terminal:

export GEMINI_API_KEY="AIza...sua_chave"


Suba a infraestrutura

docker-compose up -d --build


Aguarde a inicialização completa.

Verifique os serviços

docker ps


🔑 Acesso ao Sistema

🖥️ Dashboard (Frontend)

URL: http://localhost:5173

Credenciais de Acesso (Admin):

Email: admin@gdash.io

Senha: 123456

📚 Documentação da API (Swagger)

URL: http://localhost:3000/api

Explore e teste os endpoints diretamente pelo navegador.

🐰 Painel do RabbitMQ

URL: http://localhost:15672

Login: admin / password123

📹 Vídeo de Apresentação

Confira a demonstração completa da arquitetura e funcionamento do sistema no link abaixo:

▶️ Assistir Vídeo no YouTube

Desenvolvido por Álvaro Amorim