const fs = require('fs');
const checker = require('license-checker');

checker.init(
  {
    start: __dirname + '/../',
    production: true,
  },
  function (err, packages) {
    if (err) {
      console.error('Error:', err);
      process.exit(1);
    } else {
      const output = [];
      for (const [packageName, packageDetails] of Object.entries(packages)) {
        output.push(`## ${packageName}`);
        output.push(`- **License**: ${packageDetails.licenses}`);
        output.push(
          `- **Repository**: [${packageDetails.repository}](${packageDetails.repository})`,
        );
        if (packageDetails.publisher) {
          output.push(`- **Publisher**: ${packageDetails.publisher}`);
        }
        if (packageDetails.email) {
          output.push(`- **Email**: ${packageDetails.email}`);
        }
        if (packageDetails.url) {
          output.push(
            `- **URL**: [${packageDetails.url}](${packageDetails.url})`,
          );
        }
        if (packageDetails.licenseFile) {
          const licenseText = fs.readFileSync(
            packageDetails.licenseFile,
            'utf-8',
          );
          output.push(`- **License Text**:`);
          output.push('```');
          output.push(licenseText);
          output.push('```');
        }
        output.push('\n---\n');
      }
      fs.writeFileSync('NOTICES.md', output.join('\n'));
    }
  },
);
