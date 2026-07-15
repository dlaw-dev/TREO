@isTest
public class CompanionMattersControllerTest {

    @testSetup
    static void setup() {
        Lawsuit_Attorney_Group__c attorneyGroup = new Lawsuit_Attorney_Group__c(Name = 'Test Attorney Group');
        insert attorneyGroup;

        Lawsuit__c lawsuit = new Lawsuit__c(Lawsuit_Attorney_Group__c = attorneyGroup.Id);
        insert lawsuit;

        NEOS_Matter__c current = new NEOS_Matter__c(
            Name = 'Current Matter',
            Case_Title__c = 'QA Current Matter',
            Lawsuit_Matter__c = lawsuit.Id
        );
        NEOS_Matter__c companion = new NEOS_Matter__c(
            Name = 'Companion Matter',
            Case_Title__c = 'QA Companion Matter',
            Lawsuit_Matter__c = lawsuit.Id
        );
        NEOS_Matter__c unrelated = new NEOS_Matter__c(
            Name = 'Unrelated Matter',
            Case_Title__c = 'QA Unrelated Matter'
        );
        insert new List<NEOS_Matter__c>{ current, companion, unrelated };
    }

    @isTest
    static void testExcludesCurrentRecordFromCompanionList() {
        NEOS_Matter__c current = [SELECT Id FROM NEOS_Matter__c WHERE Case_Title__c = 'QA Current Matter'];
        NEOS_Matter__c companion = [SELECT Id FROM NEOS_Matter__c WHERE Case_Title__c = 'QA Companion Matter'];

        List<NEOS_Matter__c> results = CompanionMattersController.getCompanionMatters(current.Id, 10);

        System.assertEquals(1, results.size(), 'Only the companion matter should be returned');
        System.assertEquals(companion.Id, results[0].Id);
        for (NEOS_Matter__c m : results) {
            System.assertNotEquals(current.Id, m.Id, 'Current record must never appear in its own companion list');
        }
    }

    @isTest
    static void testReturnsEmptyListWhenNoLawsuit() {
        NEOS_Matter__c unrelated = [SELECT Id FROM NEOS_Matter__c WHERE Case_Title__c = 'QA Unrelated Matter'];

        List<NEOS_Matter__c> results = CompanionMattersController.getCompanionMatters(unrelated.Id, 10);

        System.assertEquals(0, results.size());
    }

    @isTest
    static void testRespectsMaxRecords() {
        NEOS_Matter__c current = [SELECT Id FROM NEOS_Matter__c WHERE Case_Title__c = 'QA Current Matter'];

        List<NEOS_Matter__c> results = CompanionMattersController.getCompanionMatters(current.Id, 0);

        System.assertEquals(0, results.size());
    }
}
