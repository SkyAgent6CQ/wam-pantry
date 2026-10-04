//  WAM Pantry API — Jenkins CI/CD pipeline (SIT223 7.3HD)
//
//  Build → Test → Code Quality → Security → Deploy (staging) → Release (prod) → Monitoring
//
//  Every stage is a quality gate: if it fails, later stages do not run, so
//  nothing reaches production without passing tests, the SonarQube quality gate
//  and the security policy. Deployments verify health and roll back automatically.

pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 45, unit: 'MINUTES')
    disableConcurrentBuilds()                 // two builds must never deploy at once
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '5'))
  }

  // Poll GitHub every ~2 minutes; a push to main starts the pipeline automatically.
  // (A GitHub webhook can replace this if Jenkins is reachable from the internet.)
  triggers { pollSCM('H/2 * * * *') }

  parameters {
    booleanParam(name: 'DEPLOY_TO_PRODUCTION', defaultValue: true,
      description: 'Promote to production automatically once staging passes its smoke tests.')
    choice(name: 'INCIDENT_DRILL', choices: ['none', 'app-down', 'error-rate'],
      description: 'Monitoring stage: optionally simulate an incident to prove alerts fire and resolve.')
    booleanParam(name: 'PUSH_GIT_TAG', defaultValue: false,
      description: 'Push the release tag to GitHub (needs the "github-creds" credential).')
  }

  environment {
    APP_NAME          = 'wam-pantry'
    REGISTRY          = 'localhost:5000'                 // private registry = artifact storage
    IMAGE_REPO        = "${REGISTRY}/${APP_NAME}"
    npm_config_cache  = "${JENKINS_HOME}/.npm"            // cache npm downloads between builds
    TRIVY_CACHE_DIR   = "${JENKINS_HOME}/.cache/trivy"    // cache the vulnerability DB
    CI                = 'true'
  }

  stages {

    // -------------------------------------------------------------------------
    stage('Build') {
      steps {
        script {
          env.LAST_STAGE = env.STAGE_NAME
          def pkgVersion = sh(script: "node -p \"require('./package.json').version\"", returnStdout: true).trim()
          env.GIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          // Semantic version + build number + commit => every artefact is traceable to a commit.
          env.VERSION = "${pkgVersion}-${env.BUILD_NUMBER}-${env.GIT_SHORT}"
          env.IMAGE   = "${env.IMAGE_REPO}:${env.VERSION}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} v${env.VERSION}"
        }
        sh '''
          echo "Building $APP_NAME version $VERSION (commit $GIT_COMMIT)"
          node --version && docker --version && trivy --version | head -1

          npm ci --no-audit --no-fund

          docker build --pull \
            --build-arg APP_VERSION="$VERSION" \
            --build-arg GIT_COMMIT="$GIT_COMMIT" \
            --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            -t "$IMAGE" .

          # Artefact storage: push the versioned image to the private registry ...
          docker push "$IMAGE"

          # ... and keep downloadable artefacts in Jenkins (npm package + image tarball + metadata).
          rm -rf dist && mkdir -p dist
          npm pack --pack-destination dist
          docker save "$IMAGE" | gzip > "dist/${APP_NAME}-${VERSION}.image.tar.gz"
          cat > dist/build-info.json <<EOF
{ "version": "$VERSION", "commit": "$GIT_COMMIT", "image": "$IMAGE",
  "digest": "$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE")",
  "build": "$BUILD_URL", "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
EOF
          cat dist/build-info.json
        '''
      }
      post {
        success { archiveArtifacts artifacts: 'dist/*', fingerprint: true }
      }
    }

    // -------------------------------------------------------------------------
    stage('Test') {
      steps {
        script { env.LAST_STAGE = env.STAGE_NAME }
        // Unit + integration suites with a coverage gate (jest.config.js): the
        // stage fails if any test fails OR coverage drops below the threshold.
        sh 'npm run test:ci'
      }
      post {
        always {
          junit testResults: 'reports/junit.xml', allowEmptyResults: false
          recordCoverage(tools: [[parser: 'COBERTURA', pattern: 'coverage/cobertura-coverage.xml']],
                         id: 'coverage', name: 'Code Coverage', sourceCodeRetention: 'EVERY_BUILD')
          publishHTML(target: [reportName: 'Coverage Report', reportDir: 'coverage/lcov-report',
                               reportFiles: 'index.html', keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
        }
      }
    }

    // -------------------------------------------------------------------------
    stage('Code Quality') {
      steps {
        script { env.LAST_STAGE = env.STAGE_NAME }
        sh '''
          mkdir -p reports
          npm run lint            # ESLint errors fail the build immediately
          npm run lint:report     # full ESLint report (incl. warnings) imported by SonarQube
        '''
        withSonarQubeEnv('SonarQube') {
          sh 'npm run sonar -- -Dsonar.projectVersion="$VERSION" -Dsonar.token="$SONAR_AUTH_TOKEN"'
        }
        // SonarQube calls Jenkins back via webhook; abort if the quality gate fails.
        timeout(time: 5, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    // -------------------------------------------------------------------------
    stage('Security') {
      steps {
        script { env.LAST_STAGE = env.STAGE_NAME }
        sh '''
          mkdir -p reports/security

          echo "--- npm audit: production dependencies (shipped) ---"
          npm audit --omit=dev --json > reports/security/npm-audit.json || true
          echo "--- npm audit: all dependencies incl. dev tooling ---"
          npm audit --json > reports/security/npm-audit-dev.json || true

          echo "--- Trivy: source, lockfile, secrets and IaC misconfigurations ---"
          trivy fs --quiet --scanners vuln,secret,misconfig \
            --skip-dirs node_modules,dist,coverage,reports \
            --format json --output reports/security/trivy-fs.json .

          echo "--- Trivy: container image (OS packages + Node runtime) ---"
          trivy image --quiet --scanners vuln,secret \
            --format json --output reports/security/trivy-image.json "$IMAGE"
          trivy image --quiet --scanners vuln --severity HIGH,CRITICAL --format table "$IMAGE" || true

          # Interpret results, apply the risk policy, write summary, set pass/fail.
          node scripts/security-summary.js reports/security
        '''
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/security/**', allowEmptyArchive: true
          publishHTML(target: [reportName: 'Security Summary', reportDir: 'reports/security',
                               reportFiles: 'index.html', keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
        }
      }
    }

    // -------------------------------------------------------------------------
    stage('Deploy (Staging)') {
      steps {
        script { env.LAST_STAGE = env.STAGE_NAME }
        withCredentials([string(credentialsId: 'jwt-secret', variable: 'JWT_SECRET'),
                         string(credentialsId: 'app-admin-password', variable: 'ADMIN_PASSWORD')]) {
          // Infrastructure-as-code deploy (docker compose) with health check + automatic rollback.
          sh 'scripts/deploy.sh staging "$IMAGE"'
          script {
            try {
              // Post-deployment smoke tests against the live staging container.
              sh '''
                BASE_URL=http://pantry-staging:3000 EXPECTED_VERSION="$VERSION" \
                SMOKE_ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run test:smoke
              '''
            } catch (err) {
              echo 'Smoke tests failed on staging — rolling back to the previous version.'
              sh 'scripts/rollback.sh staging || true'
              throw err
            }
          }
        }
      }
      post {
        always { junit testResults: 'reports/junit-smoke.xml', allowEmptyResults: true }
      }
    }

    // -------------------------------------------------------------------------
    stage('Release (Production)') {
      when { expression { return params.DEPLOY_TO_PRODUCTION } }
      steps {
        script { env.LAST_STAGE = env.STAGE_NAME }
        // Promote the exact image that passed staging (build once, deploy many).
        sh '''
          docker tag "$IMAGE" "$IMAGE_REPO:prod" && docker push "$IMAGE_REPO:prod"
        '''
        withCredentials([string(credentialsId: 'jwt-secret', variable: 'JWT_SECRET'),
                         string(credentialsId: 'app-admin-password', variable: 'ADMIN_PASSWORD')]) {
          sh 'scripts/deploy.sh production "$IMAGE"'
          script {
            try {
              sh '''
                BASE_URL=http://pantry-prod:3000 EXPECTED_VERSION="$VERSION" \
                SMOKE_ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run test:smoke
              '''
            } catch (err) {
              echo 'Production verification failed — rolling back production.'
              sh 'scripts/rollback.sh production || true'
              throw err
            }
          }
        }
        // Version the release: annotated Git tag + release notes + release record.
        sh '''
          git -c user.name="Jenkins" -c user.email="jenkins@wam.local" \
            tag -a -f "v$VERSION" -m "Release $VERSION (Jenkins build $BUILD_NUMBER)"
          node scripts/release-notes.js
        '''
        script {
          if (params.PUSH_GIT_TAG) {
            withCredentials([usernamePassword(credentialsId: 'github-creds',
                                              usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
              sh 'git push "https://${GH_USER}:${GH_TOKEN}@${GIT_URL#https://}" "v$VERSION"'
            }
          }
        }
      }
      post {
        always  { junit testResults: 'reports/junit-smoke.xml', allowEmptyResults: true }
        success { archiveArtifacts artifacts: 'dist/release-*', fingerprint: true }
      }
    }

    // -------------------------------------------------------------------------
    stage('Monitoring') {
      steps {
        script {
          env.LAST_STAGE = env.STAGE_NAME
          env.MONITOR_ENV = params.DEPLOY_TO_PRODUCTION ? 'production' : 'staging'
        }
        // Prometheus (metrics + alert rules), Alertmanager (routing), Grafana (dashboards)
        // and alert-notifier (team inbox / Slack / Discord). Configs are baked into images.
        sh 'docker compose -p wam-monitoring -f monitoring/docker-compose.yml up -d --build --wait --wait-timeout 120'
        // Verify targets are scraped, metrics flow, rules are loaded, and notify the team.
        sh 'node scripts/monitoring-check.js'
        script {
          if (params.INCIDENT_DRILL != 'none') {
            sh "node scripts/simulate-incident.js ${params.INCIDENT_DRILL}"
          }
        }
      }
      post {
        always { archiveArtifacts artifacts: 'reports/monitoring-check.json, reports/incident-drill-*.json', allowEmptyArchive: true }
      }
    }
  }

  post {
    success {
      sh 'node scripts/notify.js success || true'
      echo """
      ✅ v${env.VERSION} released.
         Staging     http://localhost:3001      Production  http://localhost:3000
         Grafana     http://localhost:3030      Prometheus  http://localhost:9090
         Alerts      http://localhost:9095      SonarQube   http://localhost:9000
      """
    }
    failure {
      sh 'FAILED_STAGE="$LAST_STAGE" node scripts/notify.js failure || true'
    }
    always {
      archiveArtifacts artifacts: 'reports/*.txt, reports/*.xml', allowEmptyArchive: true
      sh 'docker image prune -f >/dev/null 2>&1 || true'   // remove dangling layers only
    }
  }
}
