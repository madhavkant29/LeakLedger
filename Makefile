.PHONY: backend frontend test seed demo-reset package-lambda build-frontend build-artifacts infra-build infra-synth
backend:
	cd backend && uvicorn app.main:app --reload --port 8000
frontend:
	cd frontend && npm run dev

test:
	cd backend && pytest -q

package-lambda:
	./scripts/package_lambda.sh

seed:
	curl -s -X POST http://localhost:8000/demo/reset -H 'Content-Type: application/json' -d '{"scenario":"normal"}'

demo-reset:
	curl -s -X POST http://localhost:8000/demo/reset -H 'Content-Type: application/json' -d '{"scenario":"hidden-leak"}'


build-frontend:
	./scripts/build_frontend.sh

build-artifacts:
	./scripts/build_artifacts.sh

infra-build:
	cd infrastructure && npm run build

infra-synth:
	cd infrastructure && npm run synth
