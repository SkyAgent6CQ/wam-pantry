# Jenkins controller pre-loaded with everything the pipeline needs:
# Docker CLI + Compose (talks to the host daemon via the mounted socket),
# Node.js 22, Trivy, plugins, and Configuration-as-Code.
FROM jenkins/jenkins:lts-jdk21

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 # Docker CLI + compose plugin (no daemon - as we use the host's)
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list \
 # Node.js 22 LTS
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin nodejs \
 # Trivy (security scanner)
 && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
 && rm -rf /var/lib/apt/lists/*

# Plugins + Configuration as Code (no setup wizard, everything defined in casc/jenkins.yaml)
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/
COPY casc/ /usr/share/jenkins/ref/casc/
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc/jenkins.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

USER jenkins
