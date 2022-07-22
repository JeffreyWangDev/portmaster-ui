import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { PortmasterAPIModule } from '@safing/portmaster-api';
import { TabModule } from '@safing/ui';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';


@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    PortmasterAPIModule.forRoot(),
    TabModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
