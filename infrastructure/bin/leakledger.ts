#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { LeakLedgerStack } from '../lib/leakledger-stack';
const app = new cdk.App();
new LeakLedgerStack(app, 'LeakLedgerStack', {});
