import { normalize } from 'path';

import { updateJsonFile, updateTsConfig } from '../../utils/project';
import {
  expectFileToMatch,
  writeFile,
  replaceInFile,
  prependToFile,
  appendToFile,
} from '../../utils/fs';
import { ng, silentNpm, exec } from '../../utils/process';
import { getGlobalVariable } from '../../utils/env';
import { expectToFail } from '../../utils/utils';

export default function () {
  // Skip this in Appveyor tests.
  if (getGlobalVariable('argv').appveyor) {
    return Promise.resolve();
  }

  // Skip this for ejected tests.
  if (getGlobalVariable('argv').eject) {
    return Promise.resolve();
  }

  let platformServerVersion = '^4.0.0';

  if (getGlobalVariable('argv').nightly) {
    platformServerVersion = 'github:angular/platform-server-builds';
  }

  return Promise.resolve()
    .then(() => updateJsonFile('.angular-cli.json', configJson => {
      const app = configJson['apps'][0];
      delete app['polyfills'];
      delete app['styles'];
      app['platform'] = 'server';
    }))
    .then(() => updateJsonFile('package.json', packageJson => {
      const dependencies = packageJson['dependencies'];
      dependencies['@angular/platform-server'] = platformServerVersion;
    }))
    .then(() => updateTsConfig(tsConfig => {
      tsConfig.compilerOptions.types = ['node'];
      tsConfig['angularCompilerOptions'] = {
        entryModule: 'app/app.module#AppModule'
      };
    }))
    .then(() => writeFile('./src/main.ts', 'export { AppModule } from \'./app/app.module\';'))
    .then(() => prependToFile('./src/app/app.module.ts',
      'import { ServerModule } from \'@angular/platform-server\';'))
    .then(() => replaceInFile('./src/app/app.module.ts', /\[\s*BrowserModule/g,
      `[BrowserModule.withServerTransition(\{ appId: 'app' \}), ServerModule`))
    .then(() => silentNpm('install'))
    .then(() => ng('build'))
    // files were created successfully
    .then(() => expectFileToMatch('dist/main.bundle.js',
      /__webpack_exports__, "AppModule"/))
    .then(() => writeFile('./index.js', `
      require('zone.js/dist/zone-node');
      require('reflect-metadata');
      const fs = require('fs');
      const \{ AppModule \} = require('./dist/main.bundle');
      const \{ renderModule \} = require('@angular/platform-server');

      renderModule(AppModule, \{
        url: '/',
        document: '<app-root></app-root>'
      \}).then(html => \{
        fs.writeFileSync('dist/index.html', html);
      \});
    `))
    .then(() => exec(normalize('node'), 'index.js'))
    .then(() => expectFileToMatch('dist/index.html',
      new RegExp('<h2 _ngcontent-c0="">Here are some links to help you start: </h2>')))
    .then(() => ng('build', '--aot'))
    // files were created successfully
    .then(() => replaceInFile('./index.js', /AppModule/g, 'AppModuleNgFactory'))
    .then(() => replaceInFile('./index.js', /renderModule/g, 'renderModuleFactory'))
    .then(() => exec(normalize('node'), 'index.js'))

    // Check externals.
    .then(() => prependToFile('./src/app/app.module.ts', `
      import 'zone.js/dist/zone-node';
      import 'reflect-metadata';
    `)
    .then(() => appendToFile('./src/app/app.module.ts', `
      import * as fs from 'fs';
      import { renderModule } from '@angular/platform-server';

      renderModule(AppModule, \{
        url: '/',
        document: '<app-root></app-root>'
      \}).then(html => \{
        fs.writeFileSync('dist/index.html', html);
      \});
    `)))
    .then(() => ng('generate', 'module', 'lazy', '--routing'))
    .then(() =>
      writeFile('src/app/app.module.ts', `
        import { BrowserModule } from '@angular/platform-browser';
        import { NgModule } from '@angular/core';
        import { FormsModule } from '@angular/forms';
        import { HttpModule } from '@angular/http';

        import { AppComponent } from './app.component';
        import { RouterModule } from '@angular/router';

        @NgModule({
          declarations: [
            AppComponent
          ],
          imports: [
            BrowserModule,
            FormsModule,
            HttpModule,
            RouterModule.forRoot([
              { path: 'lazy', loadChildren: './lazy/lazy.module#LazyModule' }
            ])
          ],
          providers: [],
          bootstrap: [AppComponent]
        })
        export class AppModule { }
      `
    ))
    .then(() => ng('build', '--aot'))
    // should not contain ".ngfactory#" or "NgFactory"
    .then(() => expectFileToMatch('dist/main.bundle.js',
      'var LAZY_MODULE_MAP = { "./lazy/lazy.module#LazyModule"'));
}