.PHONY: setup build test verify ios-project ios-build ios-test specs
setup:
	npm ci --prefix frontend
	dotnet restore backend/carwash.sln
build:
	npm run typecheck --prefix frontend
	npm run build --prefix frontend
	dotnet build backend/carwash.sln
test:
	npm test --prefix frontend
	dotnet test backend/carwash.sln
specs:
	openspec validate --all --strict --no-interactive
verify: specs build test
ios-project:
	xcodegen generate --spec SparkleWash-iOS/project.yml
ios-build: ios-project
	xcodebuild -project SparkleWash-iOS/SparkleWash.xcodeproj -scheme SparkleWash -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
ios-test: ios-project
	xcodebuild -project SparkleWash-iOS/SparkleWash.xcodeproj -scheme SparkleWash -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO test
