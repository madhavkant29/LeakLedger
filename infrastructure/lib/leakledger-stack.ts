import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';

export class LeakLedgerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const rawArchive = new s3.Bucket(this, 'RawMeterArchive', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const stateTable = new dynamodb.Table(this, 'StateTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const bus = new events.EventBus(this, 'MeterEventBus');
    const dlq = new sqs.Queue(this, 'ReconciliationDLQ', {
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const queue = new sqs.Queue(this, 'ReconciliationQueue', {
      visibilityTimeout: cdk.Duration.seconds(90),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 4 },
    });

    new events.Rule(this, 'MeterReadingRule', {
      eventBus: bus,
      eventPattern: { source: ['leakledger.meters'], detailType: ['MeterReadingReceived'] },
      targets: [new targets.SqsQueue(queue, { deadLetterQueue: dlq, retryAttempts: 3 })],
    });

    const projectRoot = path.join(__dirname, '..', '..');
    const codePath = path.join(projectRoot, 'dist', 'lambda');
    // CloudFront is the intended edge for the static frontend. AWS accounts that
    // are still pending CloudFront verification cannot create distributions, so the
    // stack can serve the same static export directly through API Gateway instead.
    // Disable CloudFront with `-c leakledger:cloudfront=false` (see infrastructure/cdk.json).
    const enableCloudFront = (this.node.tryGetContext('leakledger:cloudfront') ?? 'true') !== 'false';
    const commonEnv = {
      LEAKLEDGER_MODE: 'aws',
      STATE_TABLE: stateTable.tableName,
      RAW_BUCKET: rawArchive.bucketName,
      EVENT_BUS: bus.eventBusName,
      POWERTOOLS_SERVICE_NAME: 'leakledger',
      LEAKLEDGER_SERVE_FRONTEND: enableCloudFront ? '0' : '1',
    };

    const apiFn = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.aws_handlers.api_handler',
      code: lambda.Code.fromAsset(codePath),
      timeout: cdk.Duration.seconds(30),
      memorySize: 768,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE,
    });

    const workerFn = new lambda.Function(this, 'ReconciliationWorker', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'app.worker.lambda_handler',
      code: lambda.Code.fromAsset(codePath),
      timeout: cdk.Duration.seconds(60),
      memorySize: 768,
      environment: commonEnv,
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE,
    });

    workerFn.addEventSource(new sources.SqsEventSource(queue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(2),
      reportBatchItemFailures: true,
      // Keep sibling meter events batched together and reduce interval reordering.
      maxConcurrency: 2,
    }));

    stateTable.grantReadWriteData(apiFn);
    stateTable.grantReadWriteData(workerFn);
    rawArchive.grantReadWrite(apiFn);
    rawArchive.grantReadWrite(workerFn);
    bus.grantPutEventsTo(apiFn);
    bus.grantPutEventsTo(workerFn);

    const metricPolicy = new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: { StringEquals: { 'cloudwatch:namespace': 'LeakLedger' } },
    });
    apiFn.addToRolePolicy(metricPolicy);
    workerFn.addToRolePolicy(metricPolicy);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });
    const apiIntegration = new integrations.HttpLambdaIntegration('ApiIntegration', apiFn);
    httpApi.addRoutes({ path: '/{proxy+}', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration });
    httpApi.addRoutes({ path: '/', methods: [apigwv2.HttpMethod.ANY], integration: apiIntegration });

    // Static Next.js export. Run `make build-artifacts` before `cdk deploy`.
    let frontendUrl = httpApi.apiEndpoint || '';
    if (enableCloudFront) {
      const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
      const staticRouteRewrite = new cloudfront.Function(this, 'StaticRouteRewrite', {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.split('/').pop().includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}`),
      });
      const stripApiPrefix = new cloudfront.Function(this, 'StripApiPrefix', {
        code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = request.uri.slice(4) || '/';
  return request;
}`),
      });
      const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', httpApi.apiEndpoint));
      const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
        defaultRootObject: 'index.html',
        defaultBehavior: {
          origin: new origins.S3Origin(frontendBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          compress: true,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [{ function: staticRouteRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
        additionalBehaviors: {
          'api/*': {
            origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            functionAssociations: [{ function: stripApiPrefix, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
          },
        },
      });
      new s3deploy.BucketDeployment(this, 'DeployFrontend', {
        sources: [s3deploy.Source.asset(path.join(projectRoot, 'dist', 'frontend'))],
        destinationBucket: frontendBucket,
        distribution,
        distributionPaths: ['/*'],
      });
      frontendUrl = `https://${distribution.domainName}`;
    }

    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `${cdk.Stack.of(this).stackName}-operations`,
    });
    const llMetric = (name: string, statistic = 'Sum') => new cloudwatch.Metric({
      namespace: 'LeakLedger',
      metricName: name,
      statistic,
      period: cdk.Duration.minutes(1),
      dimensionsMap: { SiteId: 'northbridge' },
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({ title: 'Meter processing', left: [llMetric('ReadingsProcessed'), llMetric('ReconciliationsCompleted'), llMetric('BalanceViolations')] }),
      new cloudwatch.GraphWidget({ title: 'Incident outcomes', left: [llMetric('IncidentsOpened'), llMetric('RepairsVerified'), llMetric('RepairsFailed'), llMetric('DataQualityFailures')] }),
      new cloudwatch.GraphWidget({ title: 'Processing latency', left: [llMetric('ProcessingLatency', 'p95')] }),
      new cloudwatch.GraphWidget({ title: 'Queue health', left: [queue.metricApproximateAgeOfOldestMessage(), queue.metricApproximateNumberOfMessagesVisible(), dlq.metricApproximateNumberOfMessagesVisible()] }),
      new cloudwatch.GraphWidget({ title: 'Lambda errors', left: [apiFn.metricErrors(), workerFn.metricErrors()] }),
    );

    new cloudwatch.Alarm(this, 'DLQAlarm', {
      metric: dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url || '' });
    new cdk.CfnOutput(this, 'FrontendUrl', { value: frontendUrl });
    new cdk.CfnOutput(this, 'FrontendMode', { value: enableCloudFront ? 'cloudfront' : 'api-gateway' });
    new cdk.CfnOutput(this, 'RawArchiveBucket', { value: rawArchive.bucketName });
    new cdk.CfnOutput(this, 'StateTableName', { value: stateTable.tableName });
    new cdk.CfnOutput(this, 'EventBusName', { value: bus.eventBusName });
    new cdk.CfnOutput(this, 'ReconciliationQueueUrl', { value: queue.queueUrl });
  }
}
